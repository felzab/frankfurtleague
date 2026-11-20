import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { configDouble } from "@/test-support/authDoubles";
import { networkFailure, refusal, serveBackend, serveHost } from "@/test-support/backend";
import { TEST_SECRETS } from "@/test-support/testEnvironment.mts";

import type { FLOutboxHandout, FLOutboxResultPayload } from "./generated/client/types";

/** Everything the drain sent, in the order it sent it: a send to the provider, or a report to the backend. */
type Step = { kind: "send"; url: string; headers: Headers; body: Record<string, unknown> } | { kind: "report"; payload: FLOutboxResultPayload };

const steps: Step[] = [];

/** The claims the backend hands out in turn, or a failure in one's place, an empty claim standing for every call after them. */
let claims: ({ mails: FLOutboxHandout[]; abandoned: number } | Response)[] = [];

/** How the provider answers each send. */
let provider: () => unknown = () => ({ id: "re-1" });

let apiKey: string | undefined = "re_test";

/** The backend's count for each outcome a report names. */
const COUNTED = { sent: "sent", retry: "repeated", abandon: "abandoned", held: "held" } as const;

// The Postausgang's two endpoints and nothing else: a request the drain sends anywhere else fails its case.
serveBackend(({ method, path, body }) => {
  if (method === "POST" && path === "/outbox/handout") {
    const claim = claims.shift() ?? { mails: [], abandoned: 0 };
    if (claim instanceof Response) return claim;
    return { lease: claim.mails.length > 0 ? "claim-1" : null, mails: claim.mails, abandoned: claim.abandoned };
  }
  if (method === "POST" && path === "/outbox/result") {
    const payload = body as FLOutboxResultPayload;
    steps.push({ kind: "report", payload });
    return { sent: 0, repeated: 0, abandoned: 0, held: 0, ignored: 0, [COUNTED[payload.result]]: 1 };
  }
  return undefined;
});

// The provider's one endpoint.
serveHost("https://api.resend.com", ({ method, url, headers, body }) => {
  if (method !== "POST" || url.pathname !== "/emails") return undefined;
  steps.push({ kind: "send", url: url.href, headers, body: body as Record<string, unknown> });
  return provider();
});

// Varied per case: whether this deployment holds the provider's key, under the production deployment that mails.
vi.doMock("@/core/config", () => configDouble({ APP_ENV: "production", AUTH_URL: "https://league.invalid" }, { authResendKey: () => apiKey }));

const { drainOutbox, takeDrainCounts } = await import("./mail");

/** One handed-out ban notice, its id and claim number spelled from `n`. */
const handed = (n: number, attempt = 1): FLOutboxHandout => ({
  id: String(n).padStart(24, "a"),
  to: `person${String(n)}@example.org`,
  data: { kind: "ban", ban_reason: "Grund", barred_until_saison_id: "2627" },
  token: null,
  secret: null,
  attempt,
});

beforeEach(() => {
  takeDrainCounts();
  steps.length = 0;
  claims = [];
  apiKey = "re_test";
  provider = () => ({ id: "re-1" });
});

const sends = () => steps.filter((step) => step.kind === "send");
// Each report's outcome, its claim aside: every case's claim is the one the backend hands out.
const reports = () => steps.flatMap((step) => (step.kind === "report" ? [omitClaim(step.payload)] : []));
const omitClaim = ({ lease: _claim, ...result }: FLOutboxResultPayload) => result;

describe("one drain of the Postausgang", () => {
  /* A send without the row's tag is an event no row is found by, and one without the hand-out's key is a second mail
     whenever an attempt breaks off after the provider took it. Each report lands before the next send, so a drain cut
     short leaves no sent mail unreported but the one in flight. */
  it("sends each mail under its hand-out's key and its row's tag, and reports it before the next goes", async () => {
    claims = [{ mails: [handed(1), handed(2, 3)], abandoned: 1 }];

    await drainOutbox();

    expect(steps.map((step) => step.kind)).toStrictEqual(["send", "report", "send", "report"]);
    expect(sends().map(({ headers }) => headers.get("Idempotency-Key"))).toStrictEqual([
      `outbox/${handed(1).id}/1`,
      `outbox/${handed(2).id}/3`,
    ]);
    expect(sends().map(({ body }) => [body["to"], body["tags"]])).toStrictEqual([
      [handed(1).to, [{ name: "outbox_id", value: handed(1).id }]],
      [handed(2).to, [{ name: "outbox_id", value: handed(2).id }]],
    ]);
    expect(reports()).toStrictEqual([
      { id: handed(1).id, result: "sent", delivery_reason: null },
      { id: handed(2).id, result: "sent", delivery_reason: null },
    ]);
    // The claim's own give-ups count with the reports', which is what the heartbeat reads.
    expect(takeDrainCounts()).toMatchObject({ sent: 2, abandoned: 1 });
  });

  /* Most drains are a write's, and a mail is given up by whichever drain meets it: the hourly pass's heartbeat reads every
     drain's count since the last, or a mail given up behind a write never reaches `/fail`. */
  it("counts every drain's outcomes until the pass takes them, and starts again from none", async () => {
    claims = [{ mails: [], abandoned: 1 }];
    await drainOutbox();
    claims = [{ mails: [handed(1)], abandoned: 0 }];
    provider = () => Response.json({ name: "validation_error" }, { status: 422 });
    await drainOutbox();

    expect(takeDrainCounts()).toStrictEqual({ sent: 0, repeated: 0, abandoned: 2, held: 0, ignored: 0 });
    expect(takeDrainCounts()).toStrictEqual({ sent: 0, repeated: 0, abandoned: 0, held: 0, ignored: 0 });
  });

  /* A call made while a drain runs waits on the drain queued after it, however the running one settles. Handed the
     running drain's failure instead, the call's mail, a sign-in code tried once among them, would wait for the hourly
     pass and lapse. */
  it("serves a call made during a drain that fails by the drain after it", async () => {
    claims = [refusal(undefined, { status: 503 }), { mails: [handed(1)], abandoned: 0 }];

    // The second call is made while the first drain still waits on its hand-out.
    const failing = drainOutbox();
    const waiting = drainOutbox();

    await expect(failing).rejects.toMatchObject({ statusCode: 503 });
    await expect(waiting).resolves.toBeUndefined();
    expect(reports()).toStrictEqual([{ id: handed(1).id, result: "sent", delivery_reason: null }]);
  });

  /* The row arrives sealed under the frontend's own key (`fl_frontend/src/core/auth/mails.ts :: oweSignInMail`): a builder
     handed the ciphertext would mail a code nobody can type. */
  it("opens a sealed secret under the frontend's key before its kind's builder renders it", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const secret = await symmetricEncrypt({ key: TEST_SECRETS.auth_secret, data: "123456" });
    claims = [{ mails: [{ ...handed(1), data: { kind: "sign_in_code" }, secret }], abandoned: 0 }];

    await drainOutbox();

    expect(sends().map(({ body }) => String(body["text"]).includes("123456"))).toStrictEqual([true]);
    expect(String(sends()[0]?.body["text"])).not.toContain(secret);
  });

  /* Claimed first on every drain, a row its key no longer opens would stop each one until the row lapses, a day for a
     deletion link, and every mail behind it with them. */
  it("gives up a secret its key no longer opens, and sends the mail behind it", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const foreign = await symmetricEncrypt({ key: "a-key-since-replaced-not-a-credential", data: "123456" });
    claims = [{ mails: [{ ...handed(1), data: { kind: "sign_in_code" }, secret: foreign }, handed(2)], abandoned: 0 }];

    await drainOutbox();

    expect(reports().map(({ id, result }) => [id, result])).toStrictEqual([
      [handed(1).id, "abandon"],
      [handed(2).id, "sent"],
    ]);
    expect(sends().map(({ body }) => body["to"])).toStrictEqual([handed(2).to]);
  });

  /* Read the wrong way round, the league's daily quota would give up every mail queued behind it, and a refusal no
     send can repair would be retried until its deadline. The provider's name for a refusal is the row's one record of
     why, no line beside it; a name the endpoint would refuse is dropped rather than failing the report. */
  it.each([
    ["a rate limit", "retry", () => Response.json({ name: "rate_limit_exceeded" }, { status: 429 }), "rate_limit_exceeded"],
    ["the daily quota", "retry", () => Response.json({ name: "daily_quota_exceeded" }, { status: 429 }), "daily_quota_exceeded"],
    ["an outage", "retry", () => new Response(null, { status: 503 }), null],
    ["a named outage", "retry", () => Response.json({ name: "dns_lookup_failed" }, { status: 503 }), "dns_lookup_failed"],
    ["a broken connection", "retry", () => networkFailure(), null],
    ["a refusal of the message itself", "abandon", () => Response.json({ name: "validation_error" }, { status: 422 }), "validation_error"],
    ["a refusal named past the endpoint's bound", "abandon", () => Response.json({ name: "x".repeat(200) }, { status: 422 }), null],
  ] as const)("reports %s as %s", async (_name, result, answer, reason) => {
    // The pauses between attempts on the case's clock, which the case runs out: `fakeNodeBuiltins` reaches the drain's
    // `node:timers/promises` import, which a fake of the global alone leaves on the wall clock. The send's own bound is
    // an `AbortSignal.timeout`, which stays on the wall clock and so never fires here.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], fakeNodeBuiltins: true });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    claims = [{ mails: [handed(1)], abandoned: 0 }];
    provider = answer;

    const drained = drainOutbox();
    await vi.runAllTimersAsync();
    await drained;

    expect(reports()).toStrictEqual([{ id: handed(1).id, result, delivery_reason: reason }]);
  });

  /* The provider reaches the mailbox inside a spelled address, whose ban the hand-out judged on the whole spelling: sent,
     the mail would reach a barred person. */
  it("gives up a row addressed to anything but one bare mailbox, and reaches no provider", async () => {
    claims = [{ mails: [{ ...handed(1), to: "Name <pia@example.org>" }], abandoned: 0 }];

    await drainOutbox();

    expect(sends()).toStrictEqual([]);
    expect(reports()).toStrictEqual([{ id: handed(1).id, result: "abandon", delivery_reason: null }]);
  });

  it("reports a deployment that sends nothing as held, and reaches no provider", async () => {
    apiKey = undefined;
    claims = [{ mails: [handed(1)], abandoned: 0 }];

    await drainOutbox();

    expect(sends()).toStrictEqual([]);
    expect(reports()).toStrictEqual([{ id: handed(1).id, result: "held", delivery_reason: null }]);
  });
});
