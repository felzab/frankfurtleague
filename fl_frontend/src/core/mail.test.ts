import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestTraceId, runWithRequestScope } from "./requestScope.ts";

import type { FLPostausgangAusgabe, FLPostausgangErgebnisPayload } from "./generated/client/types.ts";

/** Everything the drain did, in the order it did it: a send to the provider, or a report to the backend. */
type Schritt =
  { art: "send"; url: string; headers: Headers; body: Record<string, unknown> } | { art: "report"; payload: FLPostausgangErgebnisPayload };

const schritte: Schritt[] = [];

/** The claims the backend hands out in turn, the last empty one standing for every call after it. */
let claims: { mails: FLPostausgangAusgabe[]; aufgegeben: number }[] = [];

/** How the provider answers each send. */
let provider: () => Response | Promise<Response> = () => Response.json({ id: "re-1" });

let apiKey: string | undefined = "re_test";

/** The one request scope with deadline left, where a case names one: the transport refuses a claim under any other. */
let liveTrace: string | undefined;

const SDK_DOUBLE = {
  postausgangPostAusgabe: async () => {
    if (liveTrace !== undefined && getRequestTraceId() !== liveTrace)
      throw new Error("The request's deadline had passed before this call was sent.");
    const claim = claims.shift() ?? { mails: [], aufgegeben: 0 };
    const held = claim.mails.length > 0;
    return { beanspruchung: held ? "claim-1" : null, mails: claim.mails, aufgegeben: claim.aufgegeben };
  },
  postausgangPostErgebnis: async (payload: FLPostausgangErgebnisPayload) => {
    schritte.push({ art: "report", payload });
    const { ergebnis } = payload;
    const counted = { gesendet: 0, wiederholt: 0, aufgegeben: 0, zurueckgehalten: 0, ignoriert: 0 };
    const key = ({ gesendet: "gesendet", wiederholen: "wiederholt", aufgeben: "aufgegeben", zurueckgehalten: "zurueckgehalten" } as const)[
      ergebnis
    ];
    return { ...counted, [key]: 1 };
  },
};

const AUTH_SECRET = "fabricated-test-secret-not-a-credential";

const CONFIG_DOUBLE = {
  frontend_config: { APP_ENV: "production", AUTH_URL: "https://league.invalid" },
  authResendKey: () => apiKey,
  authSecret: () => AUTH_SECRET,
};

// The map is each cutover's to fill: one kind stands in, rendered as any mail is, printing the secret it is handed.
const KINDS_DOUBLE = {
  OUTBOX_TAG: "postausgang_id",
  mailFor: (_art: string, daten: { grund: string }, { origin, geheim }: { origin: string; geheim: string | null }) => ({
    art: "mitteilung",
    subjectLine: "Sperre",
    origin: origin,
    vorname: "",
    absaetze: [[daten.grund], ...(geheim === null ? [] : [[geheim]])],
  }),
};

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

vi.doMock("@/core/generated/client/sdk.ts", () => SDK_DOUBLE);
vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);
vi.doMock("@/core/mailKinds.ts", () => KINDS_DOUBLE);
vi.doMock("@/core/logging.ts", () => LOGGING_DOUBLE);

const { drainOutbox, takeDrainCounts } = await import("./mail.ts");

/** One handed-out row, its id and claim number spelled from `n`. */
const handed = (n: number, versuch = 1): FLPostausgangAusgabe => ({
  id: String(n).padStart(24, "a"),
  an: `person${String(n)}@example.org`,
  daten: { art: "sperre", grund: "Grund", gesperrt_bis_saison_id: "2627" },
  token: null,
  geheim: null,
  versuch: versuch,
});

beforeEach(() => {
  takeDrainCounts();
  schritte.length = 0;
  claims = [];
  apiKey = "re_test";
  liveTrace = undefined;
  provider = () => Response.json({ id: "re-1" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    schritte.push({
      art: "send",
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return provider();
  });
});

const sends = () => schritte.filter((schritt): schritt is Extract<Schritt, { art: "send" }> => schritt.art === "send");
// Each report's outcome, its claim aside: every case's claim is the one the double hands out.
const reports = () => schritte.flatMap((schritt) => (schritt.art === "report" ? [omitClaim(schritt.payload)] : []));
const omitClaim = ({ beanspruchung: _claim, ...ergebnis }: FLPostausgangErgebnisPayload) => ergebnis;

describe("one drain of the Postausgang", () => {
  /* A send without the row's tag is an event no row is found by, and one without the hand-out's key is a second mail
     whenever an attempt breaks off after the provider took it. Each report lands before the next send, so a drain cut
     short leaves no sent mail unreported but the one in flight. */
  it("sends each mail under its hand-out's key and its row's tag, and reports it before the next goes", async () => {
    claims = [{ mails: [handed(1), handed(2, 3)], aufgegeben: 1 }];

    await drainOutbox();

    expect(schritte.map((schritt) => schritt.art)).toStrictEqual(["send", "report", "send", "report"]);
    expect(sends().map(({ headers }) => headers.get("Idempotency-Key"))).toStrictEqual([
      `postausgang/${handed(1).id}/1`,
      `postausgang/${handed(2).id}/3`,
    ]);
    expect(sends().map(({ body }) => body["tags"])).toStrictEqual([
      [{ name: "postausgang_id", value: handed(1).id }],
      [{ name: "postausgang_id", value: handed(2).id }],
    ]);
    expect(reports()).toStrictEqual([
      { id: handed(1).id, ergebnis: "gesendet", nachricht_id: "re-1", grund: null },
      { id: handed(2).id, ergebnis: "gesendet", nachricht_id: "re-1", grund: null },
    ]);
    // The claim's own give-ups count with the reports', which is what the heartbeat reads.
    expect(takeDrainCounts()).toMatchObject({ gesendet: 2, aufgegeben: 1 });
  });

  /* Most drains are a write's, and a mail is given up by whichever drain meets it: the hourly pass's heartbeat reads every
     drain's count since the last, or a mail given up behind a write never reaches `/fail`. */
  it("counts every drain's outcomes until the pass takes them, and starts again from none", async () => {
    claims = [{ mails: [], aufgegeben: 1 }];
    await drainOutbox();
    claims = [{ mails: [handed(1)], aufgegeben: 0 }];
    provider = () => Response.json({ name: "validation_error" }, { status: 422 });
    await drainOutbox();

    expect(takeDrainCounts()).toStrictEqual({ gesendet: 0, wiederholt: 0, aufgegeben: 2, zurueckgehalten: 0, ignoriert: 0 });
    expect(takeDrainCounts()).toStrictEqual({ gesendet: 0, wiederholt: 0, aufgegeben: 0, zurueckgehalten: 0, ignoriert: 0 });
  });

  /* A call made while a drain runs waits on it. Served by that drain, or by one more under its caller's spent deadline,
     the call's mail, a sign-in code tried once among them, would wait for the hourly pass and lapse. */
  it("serves a call made during a drain that fails, under the call's own deadline", async () => {
    liveTrace = "trace-waiting";
    claims = [{ mails: [handed(1)], aufgegeben: 0 }];

    const failing = runWithRequestScope({ traceId: "trace-spent" }, drainOutbox);
    const waiting = runWithRequestScope({ traceId: "trace-waiting" }, drainOutbox);

    await expect(failing).rejects.toThrow("deadline");
    await expect(waiting).resolves.toBeUndefined();
    expect(reports()).toStrictEqual([{ id: handed(1).id, ergebnis: "gesendet", nachricht_id: "re-1", grund: null }]);
  });

  /* The row arrives sealed under the frontend's own key (`fl_frontend/src/core/auth.ts :: oweSignInMail`): a builder
     handed the ciphertext would mail a code nobody can type. */
  it("opens a sealed secret under the frontend's key before its kind's builder renders it", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const geheim = await symmetricEncrypt({ key: AUTH_SECRET, data: "123456" });
    claims = [{ mails: [{ ...handed(1), geheim: geheim }], aufgegeben: 0 }];

    await drainOutbox();

    expect(sends().map(({ body }) => String(body["text"]).includes("123456"))).toStrictEqual([true]);
    expect(String(sends()[0]?.body["text"])).not.toContain(geheim);
  });

  /* Claimed first on every drain, a row its key no longer opens would stop each one until the row lapses, a day for a
     deletion link, and every mail behind it with them. */
  it("gives up a secret its key no longer opens, and sends the mail behind it", async () => {
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const fremd = await symmetricEncrypt({ key: "a-key-since-replaced-not-a-credential", data: "123456" });
    claims = [{ mails: [{ ...handed(1), geheim: fremd }, handed(2)], aufgegeben: 0 }];

    await drainOutbox();

    expect(reports().map(({ id, ergebnis }) => [id, ergebnis])).toStrictEqual([
      [handed(1).id, "aufgeben"],
      [handed(2).id, "gesendet"],
    ]);
  });

  /* Read the wrong way round, the league's daily quota would give up every mail queued behind it, and a refusal no
     send can repair would be retried until its deadline. The provider's name for a refusal is the row's one record of
     why, no line beside it; a name the endpoint would refuse is dropped rather than failing the report. */
  it.each([
    ["a rate limit", () => Response.json({ name: "rate_limit_exceeded" }, { status: 429 }), "wiederholen", "rate_limit_exceeded"],
    ["the daily quota", () => Response.json({ name: "daily_quota_exceeded" }, { status: 429 }), "wiederholen", "daily_quota_exceeded"],
    ["an outage", () => new Response(null, { status: 503 }), "wiederholen", null],
    ["a broken connection", () => Promise.reject(new TypeError("fetch failed")), "wiederholen", null],
    ["a refusal of the message itself", () => Response.json({ name: "validation_error" }, { status: 422 }), "aufgeben", "validation_error"],
    ["a refusal named past the endpoint's bound", () => Response.json({ name: "x".repeat(200) }, { status: 422 }), "aufgeben", null],
  ] as const)("reports %s as %s", async (_name, answer, ergebnis, grund) => {
    claims = [{ mails: [handed(1)], aufgegeben: 0 }];
    provider = answer;

    await drainOutbox();

    expect(reports()).toStrictEqual([{ id: handed(1).id, ergebnis: ergebnis, nachricht_id: null, grund: grund }]);
  });

  it("reports a deployment that sends nothing as withheld, and reaches no provider", async () => {
    apiKey = undefined;
    claims = [{ mails: [handed(1)], aufgegeben: 0 }];

    await drainOutbox();

    expect(sends()).toStrictEqual([]);
    expect(reports()).toStrictEqual([{ id: handed(1).id, ergebnis: "zurueckgehalten", nachricht_id: null, grund: null }]);
  });
});
