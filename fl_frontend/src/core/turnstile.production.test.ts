import { captureLog } from "@/test-support/stdoutCapture.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { LoggedLine } from "@/test-support/stdoutCapture.ts";

/** What Cloudflare's published test site key mints (https://developers.cloudflare.com/turnstile/troubleshooting/testing/, read 2026-10-04). */
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** The secret that verifies `TEST_TOKEN`, published on the same page. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

// Under the production build's `NODE_ENV` (`fl_frontend/vitest.config.mts :: PRODUCTION_BUILD`): only its format writes
// every value a line is handed, an `error` that is no `Error` among them, which a line carrying no token is held to.
// The secret is read off the deployment's `APP_ENV`, which the run sets to the local stack's, never off `NODE_ENV`.

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

/** Whether a line as the production format wrote it carries the token anywhere, or an `error` at all; no line does too. */
const carriesTheToken = (line: LoggedLine | undefined): boolean =>
  line === undefined || line.raw.includes(TEST_TOKEN) || line.error !== undefined;

/** Every request the helper drew, and Cloudflare's answers in turn, the last one repeating; one throwing answers nothing. */
const asked: { url: string; body: Record<string, unknown> }[] = [];
let answers: (() => Response)[] = [];

// The network edge, faked, under the real config: the secret sent is the one this process boots with, which outside the
// production deployment is Cloudflare's published test secret.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  asked.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
  const answer = answers.length > 1 ? answers.shift() : answers[0];
  if (answer === undefined) throw new Error("a case asked Cloudflare without saying how it answers");

  return answer();
}) as typeof fetch;

const { CHECK_DISRUPTED, turnstileRefusal } = await import("./turnstile.ts");
const { CONFIRM_HUMAN } = await import("./turnstileToken.ts");

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const judged =
  (codes: string[]): (() => Response) =>
  () =>
    json({ success: codes.length === 0, "error-codes": codes });

beforeEach(() => {
  asked.length = 0;
  answers = [];
});

describe("the bot check's verdict on a submission", () => {
  it("passes a token Cloudflare's test key minted, asked with the test secret this process boots with", async () => {
    answers = [judged([])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(null);

    expect(asked.map(({ url, body }) => ({ url, secret: body.secret, response: body.response }))).toStrictEqual([
      { url: SITEVERIFY_URL, secret: TEST_SECRET, response: TEST_TOKEN },
    ]);
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

describe("a request of ours Cloudflare refuses", () => {
  /* A wrong, expired or rotated secret, or a request shape of ours: let through, it would switch the check
     off on every form with nothing but a log line saying so. */
  /* Answered as Cloudflare answers them, at 400: posted with its published dummy secrets, every request fault
     came back 400 and every judgement of a token 200. */
  for (const code of ["missing-input-secret", "invalid-input-secret", "bad-request"]) {
    it(`refuses the submission on ${code}, with a sentence of its own and one line naming the code and no token`, async () => {
      answers = [() => json({ success: false, "error-codes": [code] }, 400)];

      expect(await turnstileRefusal(TEST_TOKEN)).toBe(CHECK_DISRUPTED);
      expect(asked.length, "a request Cloudflare refused was asked again").toBe(1);
      expect(log.lines().map(({ message, fields }) => [message, fields])).toStrictEqual([
        ["turnstile.request_refused", { codes: code, status: 400 }],
      ]);
      assert.ok(!carriesTheToken(log.lines()[0]), "the line carried the token or an error");
    });
  }

  /* A 4xx naming no code is still Cloudflare answering that our request is wrong, which no retry repairs. */
  for (const status of [400, 403]) {
    it(`refuses the submission on a ${String(status)} naming no code, with that sentence and one line naming the status`, async () => {
      answers = [() => new Response("<html>", { status })];

      expect(await turnstileRefusal(TEST_TOKEN)).toBe(CHECK_DISRUPTED);
      expect(asked.length, "a request Cloudflare refused was asked again").toBe(1);
      expect(log.lines().map(({ message, fields }) => [message, fields])).toStrictEqual([["turnstile.request_refused", { status }]]);
    });
  }
});

describe("Cloudflare declining to judge", () => {
  /* Garbage tokens can bring a 429 on while the site stands, so passing it would switch the check off on demand. A
     code in its body judges no token, so it must not read as the visitor's failure. */
  it.each([
    ["no code", () => json({}, 429)],
    ["a code", () => json({ success: false, "error-codes": ["too-many-requests"] }, 429)],
  ])("refuses the submission on a 429 with %s, asked once, with one line naming the status", async (_, answer) => {
    answers = [answer];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(CHECK_DISRUPTED);
    expect(asked.length).toBe(1);
    expect(log.lines().map(({ message, fields }) => [message, fields])).toStrictEqual([["turnstile.request_refused", { status: 429 }]]);
  });
});

describe("Cloudflare's own failure", () => {
  /* Its page answers internal-error with "Retry the request", and an idempotency key is what makes a retry
     of one judgement safe. */
  it("is asked again once, under the same idempotency key", async () => {
    answers = [judged(["internal-error"]), judged([])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(null);
    expect(asked.length).toBe(2);
    expect(typeof asked[0]?.body.idempotency_key).toBe("string");
    expect(asked[1]?.body.idempotency_key, "the retry carried another key").toBe(asked[0]?.body.idempotency_key);
    expect(log.lines()).toStrictEqual([]);
  });

  it("is judged by the retry's answer where the retry judged the token", async () => {
    answers = [judged(["internal-error"]), judged(["invalid-input-response"])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(CONFIRM_HUMAN);
  });

  it("lets the submission through after a second internal-error, with one line", async () => {
    answers = [judged(["internal-error"])];

    expect(await turnstileRefusal(TEST_TOKEN)).toBe(null);
    expect(asked.length, "Cloudflare's failure was not asked again, or asked more than once").toBe(2);
    expect(log.lines().map(({ message }) => message)).toStrictEqual(["turnstile.unjudged"]);
  });
});

describe("a check Cloudflare could not answer", () => {
  /* Cloudflare fronts the whole site, so its outage refusing every sign-in and application would cost
     more than one submission going through unchecked. */
  const UNANSWERED: readonly [string, () => Response][] = [
    [
      "an unreachable endpoint",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["a server error", () => json({}, 503)],
    ["a body that is no JSON", () => new Response("<html>", { status: 200 })],
    ["a body of another shape", () => json({ ok: true })],
  ];

  for (const [what, answer] of UNANSWERED) {
    it(`lets the submission through on ${what}, asked once, with one line naming no token`, async () => {
      answers = [answer];

      expect(await turnstileRefusal(TEST_TOKEN)).toBe(null);
      expect(asked.length).toBe(1);
      const lines = log.lines();
      expect(lines.length, `wrote ${String(lines.length)} lines`).toBe(1);
      expect(lines[0]?.message).toBe("turnstile.unjudged");
      assert.ok(!carriesTheToken(lines[0]), "the line carried the token or an error");
    });
  }
});
