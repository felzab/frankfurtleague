import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";

/** What Cloudflare's published test site key mints (https://developers.cloudflare.com/turnstile/troubleshooting/testing/, read 2026-10-04). */
const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** The secret that verifies `TEST_TOKEN`, published on the same page. */
const TEST_SECRET = "1x0000000000000000000000000000000AA";

/** Every line the doubled logger was handed, its meta serialised whole so a token anywhere in it is found. */
const logs: { level: string; message: string; meta: string }[] = [];
const record =
  (level: string) =>
  (message: string, ...rest: unknown[]): void =>
    void logs.push({ level, message, meta: JSON.stringify(rest) });

registerDoubles({ modules: { "core/logging.ts": { logger: { info: record("info"), warn: record("warn"), error: record("error") } } } });

/** Every request the helper drew, and how Cloudflare answers the next; throwing, it answers nothing. */
const asked: { url: string; init: RequestInit }[] = [];
let siteverify: () => Response = () => {
  throw new Error("a case asked Cloudflare without saying how it answers");
};

// The network edge, as `fl_frontend/src/core/mailGate.test.ts` fakes it, under the real config: the secret
// sent is the one this process boots with, which outside production is Cloudflare's published test secret.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  asked.push({ url: String(input), init: init ?? {} });

  return siteverify();
}) as typeof fetch;

const { passesTurnstile } = await import("./turnstile.ts");

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } });

const siteverifyAnswers = (answer: () => Response): void => {
  siteverify = answer;
};

beforeEach(() => {
  logs.length = 0;
  asked.length = 0;
});

describe("the bot check's verdict on a submission", () => {
  it("passes a token Cloudflare's test key minted, asked with the test secret this process boots with", async () => {
    siteverifyAnswers(() => json({ success: true, "error-codes": [] }));

    assert.equal(await passesTurnstile(TEST_TOKEN), true);

    assert.deepEqual(
      asked.map(({ url, init }) => ({ url: url, body: JSON.parse(String(init.body)) as unknown })),
      [{ url: SITEVERIFY_URL, body: { secret: TEST_SECRET, response: TEST_TOKEN } }],
    );
    assert.deepEqual(logs, [], "a judged pass wrote a line");
  });

  /* Asked nothing: Cloudflare could only answer either with a judgement against it. */
  it("refuses a missing, empty or overlong token without asking Cloudflare", async () => {
    for (const token of [null, "", "x".repeat(2049)]) {
      assert.equal(await passesTurnstile(token), false, `passed ${JSON.stringify(token?.slice(0, 8))}`);
    }

    assert.deepEqual(asked, []);
  });

  it("refuses a token Cloudflare judged, a spent one and a forged one alike", async () => {
    for (const codes of [["invalid-input-response"], ["timeout-or-duplicate"], ["internal-error", "invalid-input-response"], []]) {
      siteverifyAnswers(() => json({ success: false, "error-codes": codes }));
      assert.equal(await passesTurnstile(TEST_TOKEN), false, `passed on ${codes.join(", ") || "no code"}`);
    }

    assert.deepEqual(logs, [], "a judged refusal wrote a line");
  });
});

describe("a check Cloudflare could not judge", () => {
  /* Cloudflare fronts the whole site, so its outage refusing every sign-in and application would cost
     more than one submission going through unchecked. */
  const UNJUDGED: readonly [string, () => Response][] = [
    [
      "an unreachable endpoint",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["a status other than 2xx", () => json({}, 503)],
    ["a body that is no JSON", () => new Response("<html>", { status: 200 })],
    ["a body of another shape", () => json({ ok: true })],
    ["Cloudflare's own failure", () => json({ success: false, "error-codes": ["internal-error"] })],
    ["a secret of ours it refused", () => json({ success: false, "error-codes": ["invalid-input-secret"] })],
  ];

  for (const [what, answer] of UNJUDGED) {
    it(`lets the submission through on ${what}, with one line naming no token`, async () => {
      siteverifyAnswers(answer);

      assert.equal(await passesTurnstile(TEST_TOKEN), true);
      assert.equal(logs.length, 1, `wrote ${String(logs.length)} lines`);
      assert.equal(logs[0]?.message, "turnstile.unjudged");
      assert.match(logs[0]?.meta ?? "", /"error_code":"FE-TURNSTILE-001"/);
      assert.ok(!logs[0]?.meta.includes(TEST_TOKEN), "the line carried the token");
    });
  }
});
