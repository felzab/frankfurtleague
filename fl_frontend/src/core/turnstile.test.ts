import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { networkFailure, serveHost } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";
import { timeoutSignalsOnFakeTimers } from "@/test-support/timeoutSignals";

import type { LoggedLine } from "@/test-support/stdoutCapture";

/** What Cloudflare's published test site key mints (https://developers.cloudflare.com/turnstile/troubleshooting/testing/, read 2026-10-04). */
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** The secret that verifies `TEST_TOKEN`, published on the same page. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

// The secret is read off the deployment's `APP_ENV`, which the run sets to the local stack's.

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

/** Whether a line as the logger wrote it carries the token anywhere, or an `error` at all; no line does too. */
const carriesTheToken = (line: LoggedLine | undefined): boolean =>
  line === undefined || line.raw.includes(TEST_TOKEN) || line.error !== undefined;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Cloudflare's answers in turn, the last one repeating; a case naming none leaves the request unanswered. */
let answers: (() => Response | Promise<Response>)[] = [];

// Cloudflare's side of the network, under the real config: the secret sent is the one this process boots with, which
// outside the production deployment is Cloudflare's published test secret.
const asked = serveHost(new URL(SITEVERIFY_URL).origin, ({ method, url }) => {
  if (method !== "POST" || url.href !== SITEVERIFY_URL) return undefined;
  const answer = answers.length > 1 ? answers.shift() : answers[0];
  return answer?.();
});

/** What the request `index` posted, as Cloudflare read it. */
const postedAt = (index: number) => asked[index]?.body as Record<string, unknown> | undefined;

const { CHECK_DISRUPTED, turnstileRefusal } = await import("./turnstile");
const { BOT_CHECK_WAIT_MS, CONFIRM_HUMAN } = await import("./turnstileToken");

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const judged =
  (codes: string[]): (() => Response) =>
  () =>
    json({ success: codes.length === 0, "error-codes": codes });

beforeEach(() => {
  answers = [];
});

describe("the bot check's verdict on a submission", () => {
  it("passes a token Cloudflare's test key minted, asked with the test secret this process boots with", async () => {
    answers = [judged([])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(null);

    expect(
      asked.map(({ url }, index) => ({ url: url.href, secret: postedAt(index)?.secret, response: postedAt(index)?.response })),
    ).toStrictEqual([{ url: SITEVERIFY_URL, secret: TEST_SECRET, response: TEST_TOKEN }]);
    expect(log.lines(), "a judged pass wrote a line").toStrictEqual([]);
  });

  /* Asked nothing: Cloudflare could only answer either with a judgement against it. */
  it("refuses a missing, empty or overlong token without asking Cloudflare", async () => {
    for (const token of [null, "", "x".repeat(2049)]) {
      expect(await turnstileRefusal(token), `passed ${JSON.stringify(token?.slice(0, 8))}`).toBe(CONFIRM_HUMAN);
    }

    expect(asked).toStrictEqual([]);
  });

  it("refuses a token Cloudflare judged, a spent one and a forged one alike", async () => {
    for (const codes of [["invalid-input-response"], ["timeout-or-duplicate"], ["internal-error", "invalid-input-response"], []]) {
      answers = [() => json({ success: false, "error-codes": codes })];
      expect(await turnstileRefusal(TEST_TOKEN), `passed on ${codes.join(", ") || "no code"}`).toBe(CONFIRM_HUMAN);
    }

    expect(log.lines(), "a judged refusal wrote a line").toStrictEqual([]);
  });
});

describe("Cloudflare's own failure", () => {
  /* Its page answers internal-error with "Retry the request", and an idempotency key is what makes a retry
     of one judgement safe. */
  it("is asked again once, under the same idempotency key", async () => {
    answers = [judged(["internal-error"]), judged([])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(null);
    expect(asked.length).toBe(2);
    expect(typeof postedAt(0)?.idempotency_key).toBe("string");
    expect(postedAt(1)?.idempotency_key, "the retry carried another key").toBe(postedAt(0)?.idempotency_key);
    expect(log.lines()).toStrictEqual([]);
  });

  it("is judged by the retry's answer where the retry judged the token", async () => {
    answers = [judged(["internal-error"]), judged(["invalid-input-response"])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(CONFIRM_HUMAN);
  });
});

describe("an answer that is no judgement of the token", () => {
  /* Passed, any of these would let every press through while it lasts, a garbage-token flood bringing on the 429 or
     a wrong, expired or rotated secret among them, with nothing but a log line saying so. The line names the status
     and the codes Cloudflare gave, so a wrong secret reads as itself. Each 4xx is answered as Cloudflare answers a
     request fault: posted with its published dummy secrets, every request fault came back 400 and every judgement of
     a token 200. */
  const NO_JUDGEMENT: readonly (readonly [string, () => Response | Promise<Response>, number, Record<string, unknown>])[] = [
    ["an unreachable endpoint", networkFailure, 1, { name: "TypeError" }],
    ["an answer past the bound", () => new Promise<never>(() => undefined), 1, { name: "TimeoutError" }],
    ["a 500", () => json({}, 500), 1, { status: 500 }],
    ["a 503", () => json({}, 503), 1, { status: 503 }],
    // The answer a wrong secret met when probed; another code at 400 takes the same branch.
    [
      "a 400 naming invalid-input-secret",
      () => json({ success: false, "error-codes": ["invalid-input-secret"] }, 400),
      1,
      { status: 400, codes: "invalid-input-secret" },
    ],
    ["a 400 naming no code", () => new Response("<html>", { status: 400 }), 1, { status: 400, name: "SyntaxError" }],
    ["a 403 naming a code", () => json({ success: false, "error-codes": ["bad-request"] }, 403), 1, { status: 403, codes: "bad-request" }],
    ["a 403 naming no code", () => new Response("<html>", { status: 403 }), 1, { status: 403, name: "SyntaxError" }],
    ["a 429 naming no code", () => json({}, 429), 1, { status: 429 }],
    [
      "a 429 naming a code",
      () => json({ success: false, "error-codes": ["too-many-requests"] }, 429),
      1,
      { status: 429, codes: "too-many-requests" },
    ],
    ["a 200 whose body is no JSON", () => new Response("<html>", { status: 200 }), 1, { status: 200, name: "SyntaxError" }],
    ["a 200 whose body is of another shape", () => json({ ok: true }), 1, { status: 200, name: "UnreadableAnswer" }],
    // Cloudflare's page documents the codes naming our secret or our request, this one among them, and no status for
    // them: today they come at 400.
    ["a 200 naming invalid-input-secret", judged(["invalid-input-secret"]), 1, { status: 200, codes: "invalid-input-secret" }],
    ["internal-error twice", judged(["internal-error"]), 2, { status: 200, codes: "internal-error" }],
  ];

  for (const [what, answer, times, fields] of NO_JUDGEMENT) {
    it(`refuses the submission on ${what}, asked ${times === 1 ? "once" : "twice"}, with one line naming no token`, async ({
      onTestFinished,
    }) => {
      // The bound runs on the case's clock, which every row moves past it: only the row that waits on it meets it.
      vi.useFakeTimers({ toFake: ["setTimeout"] });
      timeoutSignalsOnFakeTimers();
      onTestFinished(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
      });
      answers = [answer];

      const verdict = turnstileRefusal(TEST_TOKEN);
      await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS);

      expect(await verdict).toBe(CHECK_DISRUPTED);
      expect(asked.length).toBe(times);
      expect(log.lines().map(({ message, fields: logged }) => [message, logged])).toStrictEqual([["turnstile.check_disrupted", fields]]);
      assert.ok(!carriesTheToken(log.lines()[0]), "the line carried the token or an error");
    });
  }
});
