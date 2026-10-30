import { beforeEach, describe, expect, it, vi } from "vitest";

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

const SDK_DOUBLE = {
  postausgangPostAusgabe: async () => {
    const claim = claims.shift() ?? { mails: [], aufgegeben: 0 };
    const held = claim.mails.length > 0;
    return { acknowledged: 1, beanspruchung: held ? "claim-1" : null, beansprucht_bis: null, mails: claim.mails, aufgegeben: claim.aufgegeben };
  },
  postausgangPostErgebnis: async (payload: FLPostausgangErgebnisPayload) => {
    schritte.push({ art: "report", payload });
    const [{ ergebnis }] = payload.ergebnisse as [FLPostausgangErgebnisPayload["ergebnisse"][number]];
    const counted = { gesendet: 0, wiederholt: 0, aufgegeben: 0, zurueckgehalten: 0, ignoriert: 0 };
    const key = ({ gesendet: "gesendet", wiederholen: "wiederholt", aufgeben: "aufgegeben", zurueckgehalten: "zurueckgehalten" } as const)[
      ergebnis
    ];
    return { acknowledged: 1, ...counted, [key]: 1 };
  },
};

const CONFIG_DOUBLE = {
  frontend_config: { APP_ENV: "production", AUTH_URL: "https://league.invalid" },
  authResendKey: () => apiKey,
};

// The map is each cutover's to fill: one kind stands in, rendered as any mail is.
const KINDS_DOUBLE = {
  POSTAUSGANG_TAG: "postausgang_id",
  mailFor: (_art: string, daten: { grund: string }, { origin }: { origin: string }) => ({
    art: "mitteilung",
    betreff: "Sperre",
    origin: origin,
    vorname: "",
    absaetze: [[daten.grund]],
  }),
};

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

vi.doMock("@/core/generated/client/sdk.ts", () => SDK_DOUBLE);
vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);
vi.doMock("@/core/mailKinds.ts", () => KINDS_DOUBLE);
vi.doMock("@/core/logging.ts", () => LOGGING_DOUBLE);
// The ban was judged at the hand-out, so the drain never asks the gate: a call here fails the case.
vi.doMock("@/core/mailGate.ts", () => ({ mayReceiveMail: () => expect.unreachable("the drain asked the ban list") }));

const { drainPostausgang } = await import("./mail.ts");

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
  schritte.length = 0;
  claims = [];
  apiKey = "re_test";
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
const reports = () => schritte.flatMap((schritt) => (schritt.art === "report" ? schritt.payload.ergebnisse : []));

describe("one drain of the Postausgang", () => {
  /* A send without the row's tag is an event no row is found by, and one without the hand-out's key is a second mail
     whenever an attempt breaks off after the provider took it. Each report lands before the next send, so a drain cut
     short leaves no sent mail unreported but the one in flight. */
  it("sends each mail under its hand-out's key and its row's tag, and reports it before the next goes", async () => {
    claims = [{ mails: [handed(1), handed(2, 3)], aufgegeben: 1 }];

    const zaehlung = await drainPostausgang();

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
      { id: handed(1).id, ergebnis: "gesendet", nachricht_id: "re-1" },
      { id: handed(2).id, ergebnis: "gesendet", nachricht_id: "re-1" },
    ]);
    // The claim's own give-ups count with the reports', which is what the heartbeat reads.
    expect(zaehlung).toMatchObject({ gesendet: 2, aufgegeben: 1 });
  });

  /* Read the wrong way round, the league's daily quota would give up every mail queued behind it, and a refusal no
     send can repair would be retried until its deadline. */
  it.each([
    ["a rate limit", () => Response.json({ name: "rate_limit_exceeded" }, { status: 429 }), "wiederholen"],
    ["the daily quota", () => Response.json({ name: "daily_quota_exceeded" }, { status: 429 }), "wiederholen"],
    ["an outage", () => new Response(null, { status: 503 }), "wiederholen"],
    ["a broken connection", () => Promise.reject(new TypeError("fetch failed")), "wiederholen"],
    ["a refusal of the message itself", () => Response.json({ name: "validation_error" }, { status: 422 }), "aufgeben"],
  ] as const)("reports %s as %s", async (_name, answer, ergebnis) => {
    claims = [{ mails: [handed(1)], aufgegeben: 0 }];
    provider = answer;

    await drainPostausgang();

    expect(reports()).toStrictEqual([{ id: handed(1).id, ergebnis: ergebnis, nachricht_id: null }]);
  });

  it("reports a deployment that sends nothing as withheld, and reaches no provider", async () => {
    apiKey = undefined;
    claims = [{ mails: [handed(1)], aufgegeben: 0 }];

    await drainPostausgang();

    expect(sends()).toStrictEqual([]);
    expect(reports()).toStrictEqual([{ id: handed(1).id, ergebnis: "zurueckgehalten", nachricht_id: null }]);
  });
});
