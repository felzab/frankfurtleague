import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { doubleSendMail } from "@/test-support/mailDouble.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { APIBadStatusError, APINetworkError } from "@/core/errors.ts";

import type { SentMail } from "@/test-support/mailDouble.ts";

/** One thing that happened, in the order it happened: the two orderings this slice owes are orderings between the two kinds. */
type SweepEvent =
  { kind: "api"; endpoint: string; method: string; params?: Record<string, string | null>; body?: string } | ({ kind: "mail" } & SentMail);

const events: SweepEvent[] = [];
/** Addresses the doubled provider refuses, so a deletion notice can fail for one application alone. */
const refused = new Set<string>();
const withheld = new Set<string>();
const barred = new Set<string>();

/** One failure line, as an operator reads it: which half stopped, and for which season. */
type SweepLog = { event: string; saison_id: string | undefined };

const logs: SweepLog[] = [];

/** Every line as it was written, its fields whole: what a half reports per pass, and the code its failure carries. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

let appEnv = "production";

let apiAnswer: (call: ApiEvent) => unknown = () => ({});

const ADRESSWECHSEL = "/adresswechsel/sweep";

/**
 * The half after the season loop, answered apart so a case about a season's clocks never answers it. It is handed the
 * place its call carried, null on a pass's first.
 */
let adresswechselAnswer: (nach: string | null) => unknown = () => entfernt(0, 0);

/** One call of the lapsed addresses' half: how many went, took effect or were refused, how many are still due, and where the pass goes on. */
const entfernt = (anzahl: number, verbleibend: number, nach: string | null = null, wirksam = 0, verworfen = 0) => ({
  acknowledged: 1,
  entfernt: anzahl,
  verbleibend: verbleibend,
  nach: nach,
  wirksam: wirksam,
  verworfen: verworfen,
});

/** The grants' claim with nothing to announce. */
const NOTHING_CLAIMED = { acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 };

const POSTAUSGANG = "/adresswechsel/sweep/postausgang";
const ZUGESTELLT = "/adresswechsel/sweep/postausgang/zugestellt";

/** A notice an address change's end owes, as the outbox's claim hands it on. */
type Owed = {
  id: string;
  art: "wirksam" | "verworfen";
  bisherige_email: string | null;
  email: string;
  vorname: string | null;
  weg: "wartezeit" | null;
  aufgegeben: boolean;
};

/** What the outbox holds for the next claim, emptied by it, and the ids each stamp named, in order. */
let owed: Owed[] = [];
const stamps: unknown[] = [];

const outboxAnswer = (endpoint: string, body: string | undefined) => {
  if (endpoint === ZUGESTELLT) {
    stamps.push(JSON.parse(String(body)));
    return { acknowledged: 1, zugestellt: 1, ignoriert: 0 };
  }
  const mitteilungen = owed;
  owed = [];
  return { acknowledged: 1, beanspruchung: mitteilungen.length > 0 ? "claim-1" : null, beansprucht_bis: null, mitteilungen: mitteilungen };
};

// Replaced at the module boundary rather than the sweep being reshaped to admit a seam: the real
// client reaches a backend no test process runs, and the real transport posts on a key none holds.
doubleApiClient(({ endpoint, method, params, body }, schema) => {
  // The grants' pass is armed by the same boot and answers to its own suite
  // (`fl_frontend/src/features/berechtigungen/abgleich.test.ts`): here it claims nothing and is not recorded.
  if (endpoint.startsWith("/berechtigungen")) return schema.parse(NOTHING_CLAIMED);
  // The address changes' outbox, drained after every pass: answered apart, so the halves' calls stay the cases' own.
  if (endpoint === POSTAUSGANG || endpoint === ZUGESTELLT) return schema.parse(outboxAnswer(endpoint, body));
  // Into the one ordered list the mail double appends to, so a read and a send stay in the order they ran.
  const call: ApiEvent = { kind: "api", endpoint, method: method ?? "GET", params: params as ApiEvent["params"], body };
  events.push(call);
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the caller is written against.
  if (endpoint === ADRESSWECHSEL) return schema.parse(adresswechselAnswer(call.params?.nach ?? null));
  return schema.parse(apiAnswer(call));
});

const mail = doubleSendMail();

// The error arm records: which EVENT a failure is filed under is what tells an operator which half
// of a season's pass stopped, and that is a line rather than a call the transport shows.
const LOGGING_DOUBLE = {
  logger: {
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: (event: string, fields?: unknown) => void lines.push({ level: "warn", event, fields }),
    error: (event: string, _message: unknown, fields?: { saison_id?: string }) => {
      logs.push({ event, saison_id: fields?.saison_id });
      lines.push({ level: "error", event, fields });
    },
  },
};

// A getter, not a value: one process holds one module registry, so a case that could not re-read the
// deployment could only ever prove one side of it.
const CONFIG_DOUBLE = {
  frontend_config: {
    AUTH_URL: "http://localhost:3000",
    get APP_ENV() {
      return appEnv;
    },
  },
};

vi.doMock("@/core/logging.ts", () => LOGGING_DOUBLE);
vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);

const { runBewerbungSweep } = await import("./sweep.ts");
const { FLBewerbungSweepLoeschungSchema } = await import("./schemas.ts");

type ApiEvent = Extract<SweepEvent, { kind: "api" }>;

const apiCalls = (): ApiEvent[] => events.filter((event): event is ApiEvent => event.kind === "api");

/** The season a call addresses, which the contract puts in the path rather than in a parameter. */
const saisonOf = (call: ApiEvent): string => call.endpoint.split("/")[3] ?? "";

/** One prefix's season pass alone: the stamp and the erasure sit under the application's prefix and would count as one. */
const passesUnder = (prefix: string): ApiEvent[] =>
  apiCalls().filter((call) => call.method === "POST" && new RegExp(`^/${prefix}/sweep/[^/]+$`).test(call.endpoint));

const seasonPasses = (): ApiEvent[] => passesUnder("bewerbungen");

const registrierungPasses = (): ApiEvent[] => passesUnder("registrierungen");

/** One call by the endpoint it addressed: the registration pass now follows every season, so no call is the last one by position. */
const callTo = (endpoint: string): ApiEvent | undefined => apiCalls().find((call) => call.endpoint === endpoint);

function answerWith(answer: (call: ApiEvent) => unknown): void {
  apiAnswer = answer;
}

/** One season's pass, with nothing for either side to do unless a case says otherwise. */
function sweepAnswers({
  saisonIds = [],
  erinnerungen = {},
  loeschungen = {},
  registrierungErinnerungen = {},
}: {
  saisonIds?: string[];
  erinnerungen?: Record<string, unknown[]>;
  loeschungen?: Record<string, unknown[]>;
  registrierungErinnerungen?: Record<string, unknown[]>;
}): void {
  answerWith((call) => {
    const saisonId = saisonOf(call);
    if (call.method === "GET") {
      return { acknowledged: 1, saison_ids: saisonIds, sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
    }
    if (call.endpoint === "/bewerbungen/zustellung/angenommen") return { acknowledged: 1, angewendet: ["ansprechperson"] };
    if (call.endpoint === "/zustellung/angenommen") return { acknowledged: 1, angewendet: true };
    if (call.endpoint.endsWith("/angekuendigt")) return { acknowledged: 1, saison_id: saisonId, angekuendigt: 1, fehlgeschlagen: 0 };
    if (call.endpoint.endsWith("/loeschen"))
      return { acknowledged: 1, saison_id: saisonId, geloescht: 1, redigierte_aktionen: 1, fehlgeschlagen: 0 };
    if (call.endpoint.startsWith("/registrierungen/sweep/")) {
      return {
        acknowledged: 1,
        saison_id: saisonId,
        erinnerungen: registrierungErinnerungen[saisonId] ?? [],
        benachrichtigt: [],
        geloescht_unbestaetigt: 0,
        geloescht_ohne_entscheidung: 0,
        geloescht_abgelehnt: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: 0,
      };
    }

    return {
      acknowledged: 1,
      saison_id: saisonId,
      erinnerungen: erinnerungen[saisonId] ?? [],
      loeschungen: loeschungen[saisonId] ?? [],
      abgelehnte_geloescht: 0,
      angenommene_geloescht: 0,
      ohne_entscheidung_geloescht: 0,
      kontaktbloecke_geleert: 0,
      redigierte_aktionen: 0,
      fehlgeschlagen: 0,
    };
  });
}

/** Application ids as the mirror demands them: `CustomObjectIdStringSchema` takes 24 hex characters and nothing else. */
const ID_REACHED = `${"a".repeat(23)}1`;
const ID_SILENT = `${"b".repeat(23)}2`;
const ID_NOBODY = `${"c".repeat(23)}3`;

/** One deletion candidate nobody has been told about yet; a null address is the seat the erasure emptied. */
const deletion = (bewerbungId: string, address: string | null, rollen: string[] = ["ansprechperson"]) => ({
  angekuendigt: false,
  bewerbung_id: bewerbungId,
  saison_id: "2627",
  schule: "Goetheschule",
  bestaetigungsfrist: "2026-09-04",
  ansprechperson_email: address,
  ansprechperson_rollen: address === null ? [] : rollen,
  // A seat with no name is the shape that reaches this clock most often: an erased seat counts as
  // outstanding, and the notice still has to name what was never confirmed.
  ausstehend: [{ rolle: "trainer", vorname: null }],
});

beforeEach(() => {
  events.length = 0;
  logs.length = 0;
  lines.length = 0;
  refused.clear();
  withheld.clear();
  barred.clear();
  // Appended as the send happens, so a send and the calls around it stay in the order they ran.
  mail.answerWith((sent) => {
    events.push({ kind: "mail", ...sent });
    return refused.has(sent.to) ? "refused" : withheld.has(sent.to) ? "withheld" : barred.has(sent.to) ? "barred" : "accepted";
  });
  appEnv = "production";
  sweepAnswers({});
  adresswechselAnswer = () => entfernt(0, 0);
  owed = [];
  stamps.length = 0;
});

describe("one pass of the sweep", () => {
  it("calls the backend once per season", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await runBewerbungSweep();

    expect(seasonPasses().map(saisonOf)).toStrictEqual(["2526", "2627"]);
  });

  it("stamps the reminder before it mails it, so a refused address costs one reminder rather than a daily one", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      erinnerungen: {
        "2627": [
          {
            bewerbung_id: ID_REACHED,
            saison_id: "2627",
            schule: "Goetheschule",
            bestaetigungsfrist: "2026-09-18",
            email: "erika@schule.de",
            seats: [{ rollen: ["ansprechperson"], vorname: "Erika", token: "token-a" }],
          },
        ],
      },
    });

    await runBewerbungSweep();

    expect(events.map((event) => event.kind)).toStrictEqual(["api", "api", "mail", "api", "api", "api"]);
  });

  /* One press answers the pair, so a second link asks one reader twice over one decision. The
     backend mints per link for that reason, and this is the half a reader actually receives. */
  it("carries one link and both role names where one person holds two seats", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      erinnerungen: {
        "2627": [
          {
            bewerbung_id: ID_REACHED,
            saison_id: "2627",
            schule: "Goetheschule",
            bestaetigungsfrist: "2026-09-18",
            email: "erika@schule.de",
            seats: [{ rollen: ["trainer", "ansprechperson"], vorname: "Erika", token: "token-paar" }],
          },
        ],
      },
    });

    await runBewerbungSweep();

    const reminder = events.find((event) => event.kind === "mail");
    expect(reminder?.text.match(/\/bestaetigung\/kontakt\?token=/g)?.length, "the paired mailbox was sent a second link").toBe(1);
    // The CONFIGURED origin and never the published one.
    assert.ok(
      reminder?.text.includes("http://localhost:3000/bestaetigung/kontakt?token=token-paar"),
      "the reminder's link is minted on an origin this run was not configured with",
    );
    assert.ok(reminder?.text.includes("Ansprechperson und Trainerin oder Trainer"), "the one link names one of the two seats it answers");
  });

  it("mails the deletion notice, stamps what was delivered, and erases only that", async () => {
    refused.add("stumm@schule.de");
    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: {
        "2627": [deletion(ID_REACHED, "erika@schule.de"), deletion(ID_SILENT, "stumm@schule.de")],
      },
    });

    await runBewerbungSweep();

    const stamp = callTo("/bewerbungen/sweep/2627/angekuendigt");
    const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
    expect(
      events.map((event) => event.kind),
      "both notices go out before anything is stamped or erased",
    ).toStrictEqual(["api", "api", "mail", "api", "mail", "api", "api", "api", "api"]);
    expect(stamp?.endpoint).toBe("/bewerbungen/sweep/2627/angekuendigt");
    expect(JSON.parse(stamp?.body ?? "{}")).toStrictEqual({ bewerbung_ids: [ID_REACHED] });
    expect(erasure?.endpoint).toBe("/bewerbungen/sweep/2627/loeschen");
    expect(JSON.parse(erasure?.body ?? "{}")).toStrictEqual({ bewerbung_ids: [ID_REACHED] });
  });

  /* A deployment that mails nothing files the notice, and off production that is as told as anyone
     there is; production waits for a real send, a withheld one there being a deployment missing its key. */
  for (const [env, erased] of [
    ["local", true],
    ["production", false],
  ] as const) {
    it(`${erased ? "stamps and erases" : "keeps"} a candidate whose notice was filed on ${env}`, async () => {
      appEnv = env;
      withheld.add("erika@schule.de");
      sweepAnswers({ saisonIds: ["2627"], loeschungen: { "2627": [deletion(ID_REACHED, "erika@schule.de")] } });

      await runBewerbungSweep();

      expect(events.filter((event) => event.kind === "mail").length, "the notice was never sent, so nothing was filed").toBe(1);
      const stamp = callTo("/bewerbungen/sweep/2627/angekuendigt");
      const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
      expect([stamp, erasure].map((call) => (call === undefined ? null : JSON.parse(call.body ?? "{}")))).toStrictEqual(
        erased ? [{ bewerbung_ids: [ID_REACHED] }, { bewerbung_ids: [ID_REACHED] }] : [null, null],
      );
    });
  }

  /* On production too: a barred mailbox is as told as the league may make it, and waiting on a send
     the ban never lets out would keep the application for as long as the ban stands. */
  it("stamps and erases a candidate whose one mailbox the ban list holds, on production", async () => {
    mail.answerWith((sent) => {
      events.push({ kind: "mail", ...sent });
      return "barred";
    });
    sweepAnswers({ saisonIds: ["2627"], loeschungen: { "2627": [deletion(ID_REACHED, "erika@schule.de")] } });

    await runBewerbungSweep();

    expect(events.filter((event) => event.kind === "mail").length, "the notice was never handed to the mailer").toBe(1);
    const stamp = callTo("/bewerbungen/sweep/2627/angekuendigt");
    const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
    expect([stamp, erasure].map((call) => (call === undefined ? null : JSON.parse(call.body ?? "{}")))).toStrictEqual([
      { bewerbung_ids: [ID_REACHED] },
      { bewerbung_ids: [ID_REACHED] },
    ]);
  });

  /* The pass after an erasure that failed: the candidate is listed again, already announced. Mailing
     it a second time is what the stamp exists to stop, and the erasure is retried on its own. */
  it("mails nothing for a candidate already announced, and erases it without a second stamp", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: { "2627": [{ ...deletion(ID_REACHED, "erika@schule.de"), angekuendigt: true }] },
    });

    await runBewerbungSweep();

    const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
    expect(
      events.map((event) => event.kind),
      "an announced candidate was mailed or stamped again",
    ).toStrictEqual(["api", "api", "api", "api", "api"]);
    expect(erasure?.endpoint).toBe("/bewerbungen/sweep/2627/loeschen");
    expect(JSON.parse(erasure?.body ?? "{}")).toStrictEqual({ bewerbung_ids: [ID_REACHED] });
  });

  /* The submitter who is also the Trainer reads „Eingetragen als“ and has to recognise themselves in
     it; the Ansprechperson alone reads as somebody else's message about their own application. */
  it("names the notice's reader by every seat that one mailbox holds", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: { "2627": [deletion(ID_REACHED, "erika@schule.de", ["trainer", "ansprechperson"])] },
    });

    await runBewerbungSweep();

    const noticeMail = events.find((event) => event.kind === "mail");
    assert.ok(noticeMail?.text.includes("Ansprechperson und Trainerin oder Trainer"), "the notice names one of the two seats its reader holds");
  });

  it("erases a candidate whose Ansprechperson seat is empty, there being nobody left to tell", async () => {
    sweepAnswers({ saisonIds: ["2627"], loeschungen: { "2627": [deletion(ID_NOBODY, null)] } });

    await runBewerbungSweep();

    const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
    expect(
      events.map((event) => event.kind),
      "no message is composed for a candidate with no address",
    ).toStrictEqual(["api", "api", "api", "api", "api", "api"]);
    expect(JSON.parse(erasure?.body ?? "{}")).toStrictEqual({ bewerbung_ids: [ID_NOBODY] });
  });

  /* Holding an undeliverable application past its erasure window is the backend's alone:
     `fl_backend/app/api/bewerbungen/services.py :: announcement_is_undeliverable` drops a refused
     Ansprechperson out of `:: deletion_is_due`, so no held application is listed here. */
  it("mails every candidate the listing hands it, reading no delivery state to withhold one on", async () => {
    assert.ok(
      !Object.keys(FLBewerbungSweepLoeschungSchema.shape).some((feld) => feld.includes("zustellung")),
      "the listing's row carries a delivery state again, which is the backend's judgement arriving where it can be redone",
    );

    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: { "2627": [deletion(ID_REACHED, "erika@schule.de"), deletion(ID_SILENT, "stumm@schule.de")] },
    });

    await runBewerbungSweep();

    expect(events.filter((event) => event.kind === "mail").length, "a listed candidate was held back on this side").toBe(2);
    expect(JSON.parse(callTo("/bewerbungen/sweep/2627/loeschen")?.body ?? "{}")).toStrictEqual({ bewerbung_ids: [ID_REACHED, ID_SILENT] });
  });

  /* The one send here whose body cannot change inside the provider's window, and the one that can
     legitimately repeat: a pass that mailed and then failed to stamp composes it again an hour on. */
  it("passes an idempotency key with the deletion notice and none with a reminder", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      erinnerungen: {
        "2627": [
          {
            bewerbung_id: ID_REACHED,
            saison_id: "2627",
            schule: "Goetheschule",
            bestaetigungsfrist: "2026-09-18",
            email: "erika@schule.de",
            seats: [{ rollen: ["ansprechperson"], vorname: "Erika", token: "token-a" }],
          },
        ],
      },
      loeschungen: { "2627": [deletion(ID_SILENT, "stumm@schule.de")] },
    });

    await runBewerbungSweep();

    const [reminder, noticeMail] = events.filter((event) => event.kind === "mail");

    expect(reminder?.idempotencyKey, "the reminder mints a fresh token, so a reused key would be refused over a changed body").toBe(undefined);
    expect(String(noticeMail?.idempotencyKey)).toMatch(/^loeschung_/);
    expect(reminder?.tags).toStrictEqual({ bewerbung_id: ID_REACHED, rollen: "ansprechperson", anlass: "erinnerung" });
    expect(noticeMail?.tags).toStrictEqual({ bewerbung_id: ID_SILENT, rollen: "ansprechperson", anlass: "loeschung" });
  });

  it("carries on to the next season when one throws", async () => {
    answerWith((call) => {
      if (call.method === "GET") {
        return { acknowledged: 1, saison_ids: ["2526", "2627"], sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
      }
      if (saisonOf(call) === "2526") throw new Error("the backend refused this season");
      if (call.endpoint.startsWith("/registrierungen/sweep/")) {
        return {
          acknowledged: 1,
          saison_id: saisonOf(call),
          erinnerungen: [],
          benachrichtigt: [],
          geloescht_unbestaetigt: 0,
          geloescht_ohne_entscheidung: 0,
          geloescht_abgelehnt: 0,
          redigierte_aktionen: 0,
          fehlgeschlagen: 0,
        };
      }
      return {
        acknowledged: 1,
        saison_id: saisonOf(call),
        erinnerungen: [],
        loeschungen: [],
        abgelehnte_geloescht: 0,
        angenommene_geloescht: 0,
        ohne_entscheidung_geloescht: 0,
        kontaktbloecke_geleert: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: 0,
      };
    });

    await runBewerbungSweep();

    expect(seasonPasses().map(saisonOf)).toStrictEqual(["2526", "2627"]);
  });
});

describe("the line a failed call files", () => {
  /* A refusal and a crash carry the same name: the status and code tell them apart, and the trace joins
     the line to the backend's own for that request. */
  it("names a refused call's status, code and trace on its failure line", async () => {
    answerWith(() => {
      throw new APIBadStatusError({
        message: "The backend failed the request.",
        url: "http://backend:8000/api/v0/bewerbungen/sweep",
        endpoint: "/bewerbungen/sweep",
        method: "GET",
        readOnly: false,
        statusCode: 500,
        serverErrorCode: "DB-FAIL-001",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
    });

    await runBewerbungSweep();

    expect(lines.filter(({ level }) => level === "error").map(({ fields }) => fields)).toStrictEqual([
      {
        name: "APIBadStatusError",
        status: 500,
        server_error_code: "DB-FAIL-001",
        trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
        saison_id: undefined,
      },
    ]);
  });

  /* No status: the backend never answered, so the trace is all that finds the request in its log, if it
     arrived there at all. */
  it("names an unanswered call's trace on its failure line", async () => {
    answerWith(() => {
      throw new APINetworkError({
        message: "The backend did not answer.",
        url: "http://backend:8000/api/v0/bewerbungen/sweep",
        method: "GET",
        readOnly: true,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        isTimeout: true,
      });
    });

    await runBewerbungSweep();

    expect(lines.filter(({ level }) => level === "error").map(({ fields }) => fields)).toStrictEqual([
      { name: "APINetworkError", trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", saison_id: undefined },
    ]);
  });
});

/** Registration ids as the mirror demands them: `CustomObjectIdStringSchema` takes 24 hex characters and nothing else. */
const ID_PUPIL = `${"d".repeat(23)}4`;

const reminder = (registrierungId: string, email: string, token: string) => ({
  registrierung_id: registrierungId,
  saison_id: "2627",
  team: "Adler",
  email: email,
  token: token,
});

describe("the registration half of one pass", () => {
  /* The detail the shape invites getting wrong: the application half returns early where it has
     nothing to erase, and a registration call inside that arm runs for no season with a quiet queue. */
  it("runs for a season whose application half erased nothing at all", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await runBewerbungSweep();

    expect(registrierungPasses().map(saisonOf)).toStrictEqual(["2526", "2627"]);
  });

  it("runs after the application's own pass, whose call stamps the day", async () => {
    sweepAnswers({ saisonIds: ["2627"] });

    await runBewerbungSweep();

    expect(apiCalls().map((call) => call.endpoint)).toStrictEqual([
      "/bewerbungen/sweep",
      "/bewerbungen/sweep/2627",
      "/registrierungen/sweep/2627",
      ADRESSWECHSEL,
    ]);
  });

  it("mails the pupil's reminder with the fresh link and no idempotency key", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      registrierungErinnerungen: { "2627": [reminder(ID_PUPIL, "quillhilde@schule.de", "token-frisch")] },
    });

    await runBewerbungSweep();

    const chase = events.find((event) => event.kind === "mail");
    expect(chase?.to).toBe("quillhilde@schule.de");
    // The CONFIGURED origin and never the published one: a link built on the latter sends a reader
    // of this stack into production.
    assert.ok(
      chase?.text.includes("http://localhost:3000/bestaetigung/spieler?token=token-frisch"),
      "the message carries the link the pass just minted, on the origin this run is configured with",
    );
    // The window the first message named: the sentence says the deadline has not moved, and seven is
    // the mirrored bound rather than a number this file spells.
    assert.ok(chase?.text.includes("7 Tagen"), "the reminder states the window the first message named");
    expect(chase?.idempotencyKey, "a fresh token in the body makes a reused key a refusal rather than a collapse").toBe(undefined);
    expect(chase?.tags).toStrictEqual({ ziel: "registrierung", ziel_id: ID_PUPIL, anlass: "erinnerung" });
  });

  /* `docs/ops/runbooks.md` section 9 reads one call for both dates: a fresh one beside a stale one
     is what says WHICH timer stopped, and it only says that while the two are stamped apart. */
  it("leaves the application's day stamped when the registration half throws", async () => {
    const stamped: Record<string, string | null> = { bewerbung: null, registrierung: null };

    answerWith((call) => {
      if (call.method === "GET") {
        return {
          acknowledged: 1,
          saison_ids: ["2627"],
          sweep_gelaufen_am: stamped.bewerbung,
          registrierung_sweep_gelaufen_am: stamped.registrierung,
        };
      }
      if (call.endpoint.startsWith("/registrierungen/sweep/")) throw new Error("the registration sweep refused this season");

      // The application's own endpoint stamps the day, which is why its call goes first.
      stamped.bewerbung = "2026-09-21";

      return {
        acknowledged: 1,
        saison_id: saisonOf(call),
        erinnerungen: [],
        loeschungen: [],
        abgelehnte_geloescht: 0,
        angenommene_geloescht: 0,
        ohne_entscheidung_geloescht: 0,
        kontaktbloecke_geleert: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: 0,
      };
    });

    await runBewerbungSweep();

    expect(stamped.bewerbung, "the application's pass was abandoned with the registration's").toBe("2026-09-21");
    expect(stamped.registrierung).toBe(null);
  });

  /* The half that starved the other: a throw anywhere in the application's clocks skips no
     registration now, and the rows it does not reach hold a minor's name, address and birthdate. */
  it("runs for a season whose application half threw", async () => {
    answerWith((call) => {
      if (call.method === "GET") {
        return { acknowledged: 1, saison_ids: ["2627"], sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
      }
      if (call.endpoint.startsWith("/bewerbungen/sweep/")) throw new Error("the application sweep refused this season");

      return {
        acknowledged: 1,
        saison_id: saisonOf(call),
        erinnerungen: [],
        benachrichtigt: [],
        geloescht_unbestaetigt: 0,
        geloescht_ohne_entscheidung: 0,
        geloescht_abgelehnt: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: 0,
      };
    });

    await runBewerbungSweep();

    expect(registrierungPasses().map(saisonOf)).toStrictEqual(["2627"]);
  });

  it("files a failure line naming the half that stopped", async () => {
    answerWith((call) => {
      if (call.method === "GET") {
        return { acknowledged: 1, saison_ids: ["2526", "2627"], sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
      }
      if (call.endpoint === "/bewerbungen/sweep/2526") throw new Error("the application sweep refused this season");
      if (call.endpoint === "/registrierungen/sweep/2627") throw new Error("the registration sweep refused this season");
      if (call.endpoint.startsWith("/registrierungen/sweep/")) {
        return {
          acknowledged: 1,
          saison_id: saisonOf(call),
          erinnerungen: [],
          benachrichtigt: [],
          geloescht_unbestaetigt: 0,
          geloescht_ohne_entscheidung: 0,
          geloescht_abgelehnt: 0,
          redigierte_aktionen: 0,
          fehlgeschlagen: 0,
        };
      }

      return {
        acknowledged: 1,
        saison_id: saisonOf(call),
        erinnerungen: [],
        loeschungen: [],
        abgelehnte_geloescht: 0,
        angenommene_geloescht: 0,
        ohne_entscheidung_geloescht: 0,
        kontaktbloecke_geleert: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: 0,
      };
    });

    await runBewerbungSweep();

    expect(logs).toStrictEqual([
      { event: "bewerbung.sweep_failed", saison_id: "2526" },
      { event: "registrierung.sweep_failed", saison_id: "2627" },
    ]);
  });

  it("carries on to the next season when one season's registration half throws", async () => {
    answerWith((call) => {
      if (call.method === "GET") {
        return { acknowledged: 1, saison_ids: ["2526", "2627"], sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
      }
      if (call.endpoint === "/registrierungen/sweep/2526") throw new Error("the registration sweep refused this season");
      if (call.endpoint.startsWith("/registrierungen/sweep/")) {
        return {
          acknowledged: 1,
          saison_id: saisonOf(call),
          erinnerungen: [],
          benachrichtigt: [],
          geloescht_unbestaetigt: 0,
          geloescht_ohne_entscheidung: 0,
          geloescht_abgelehnt: 0,
          redigierte_aktionen: 0,
          fehlgeschlagen: 0,
        };
      }

      return {
        acknowledged: 1,
        saison_id: saisonOf(call),
        erinnerungen: [],
        loeschungen: [],
        abgelehnte_geloescht: 0,
        angenommene_geloescht: 0,
        ohne_entscheidung_geloescht: 0,
        kontaktbloecke_geleert: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: 0,
      };
    });

    await runBewerbungSweep();

    expect(registrierungPasses().map(saisonOf)).toStrictEqual(["2526", "2627"]);
  });
});

describe("the line each season half files for a pass", () => {
  /** The two season halves' lines, as an operator greps them. */
  const seasonLines = () => lines.filter(({ event }) => event === "bewerbung.sweep_pass" || event === "registrierung.sweep_pass");

  /**
   * Two seasons: the application half of the first passes rows over in all three calls, the registration half of the
   * second in its one. Each count is distinct, so a sum missing one reads as another number.
   */
  function passingRowsOver(angekuendigtAnswer: (saisonId: string) => unknown): void {
    answerWith((call) => {
      const saisonId = saisonOf(call);
      if (call.method === "GET") {
        return { acknowledged: 1, saison_ids: ["2526", "2627"], sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
      }
      if (call.endpoint === "/bewerbungen/zustellung/angenommen") return { acknowledged: 1, angewendet: ["ansprechperson"] };
      if (call.endpoint.endsWith("/angekuendigt")) return angekuendigtAnswer(saisonId);
      if (call.endpoint.endsWith("/loeschen")) {
        return { acknowledged: 1, saison_id: saisonId, geloescht: 1, redigierte_aktionen: 1, fehlgeschlagen: 4 };
      }
      if (call.endpoint.startsWith("/registrierungen/sweep/")) {
        return {
          acknowledged: 1,
          saison_id: saisonId,
          erinnerungen: [],
          benachrichtigt: [],
          geloescht_unbestaetigt: 0,
          geloescht_ohne_entscheidung: 0,
          geloescht_abgelehnt: 0,
          redigierte_aktionen: 0,
          fehlgeschlagen: saisonId === "2627" ? 8 : 0,
        };
      }

      return {
        acknowledged: 1,
        saison_id: saisonId,
        erinnerungen: [],
        loeschungen: saisonId === "2526" ? [deletion(ID_REACHED, "reached@schule.de")] : [],
        abgelehnte_geloescht: 0,
        angenommene_geloescht: 0,
        ohne_entscheidung_geloescht: 0,
        kontaktbloecke_geleert: 0,
        redigierte_aktionen: 0,
        fehlgeschlagen: saisonId === "2526" ? 1 : 0,
      };
    });
  }

  it("files one line a pass for each half, at info where no call passed a row over", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await runBewerbungSweep();

    expect(seasonLines()).toStrictEqual([
      { level: "info", event: "bewerbung.sweep_pass", fields: { fehlgeschlagen: 0 } },
      { level: "info", event: "registrierung.sweep_pass", fields: { fehlgeschlagen: 0 } },
    ]);
  });

  /* A clock failing on every row still answers 200 and stamps the day, so a fresh date cannot tell it from a healthy
     one: this warning is the one line that can (`docs/ops/runbooks.md` section 9). */
  it("warns the rows each half passed over, summed over every season and call", async () => {
    passingRowsOver((saisonId) => ({ acknowledged: 1, saison_id: saisonId, angekuendigt: 1, fehlgeschlagen: 2 }));

    await runBewerbungSweep();

    expect(seasonLines()).toStrictEqual([
      { level: "warn", event: "bewerbung.sweep_pass", fields: { fehlgeschlagen: 7 } },
      { level: "warn", event: "registrierung.sweep_pass", fields: { fehlgeschlagen: 8 } },
    ]);
  });

  it("keeps the counts of the calls that answered where a later call of the half throws", async () => {
    passingRowsOver(() => {
      throw new Error("the stamp was refused");
    });

    await runBewerbungSweep();

    expect(seasonLines()[0]).toStrictEqual({
      level: "warn",
      event: "bewerbung.sweep_pass",
      fields: { fehlgeschlagen: 1 },
    });
  });
});

describe("the half after the season loop", () => {
  /** The season halves' own pass lines, which come first in every pass and are another case's. */
  const SEASON_HALVES = /^(bewerbung|registrierung)\.sweep_pass$/;

  /** The place each call of the lapsed addresses' half carried, in the order they ran. */
  const halfCalls = (): ApiEvent["params"][] =>
    apiCalls()
      .filter(({ endpoint }) => endpoint === ADRESSWECHSEL)
      .map(({ params }) => params);

  /** Answers each call with the next of `answers`, the last one standing for every call after it. */
  const inTurn = <T>(answers: T[]) => {
    let turn = 0;
    return (): T => answers[Math.min(turn++, answers.length - 1)] as T;
  };

  /* A lapsed address is a stranger's mailbox kept past its day, so nothing holds it back. The pupils' deletion is a
     job of its own, and this pass deletes nobody. */
  it("removes the lapsed addresses on every pass after the seasons, and deletes no pupil", async () => {
    sweepAnswers({ saisonIds: ["2627"] });

    await runBewerbungSweep();

    expect(apiCalls().map((call) => call.endpoint)).toStrictEqual([
      "/bewerbungen/sweep",
      "/bewerbungen/sweep/2627",
      "/registrierungen/sweep/2627",
      ADRESSWECHSEL,
    ]);
  });

  /* No season reaches the half, so a season list the backend could not answer leaves it to run. */
  it("runs where the season list could not be read", async () => {
    answerWith(() => {
      throw new Error("the season list was refused");
    });

    await runBewerbungSweep();

    assert.deepEqual(halfCalls(), [{}]);
  });

  /** Places in the `_id` order, as the mirror demands them. */
  const ORT_ADRESSE = `${"d".repeat(23)}4`;

  /* The pass is the caller's to hold: each call carries the place the call before it answered, and the first answer
     naming none ends it, whatever `verbleibend` still counts. */
  it("hands each call the place the last answer named, and calls no further once one names none", async () => {
    // The list closes on an answer naming no place, so a loop that ignores the end fails on its count rather than hanging.
    adresswechselAnswer = inTurn([entfernt(2, 1, ORT_ADRESSE), entfernt(1, 1), entfernt(4, 4)]);

    await runBewerbungSweep();

    // A first call carrying no `nach` at all, never a null one: present, the server reads it as an id.
    assert.deepEqual(halfCalls(), [{}, { nach: ORT_ADRESSE }]);
  });

  /**
   * Answers a call carrying no place with the failing front, and the call carrying `ort` with the due row behind it.
   * Bounded: a loop dropping the place ends on its fourth call rather than hanging.
   */
  const vorneDann = <T>(ort: string, vorne: T, dahinter: T, ende: T) => {
    let ohneOrt = 0;
    return (nach: string | null): T => (nach === ort ? dahinter : ++ohneOrt <= 3 ? vorne : ende);
  };

  /* A share's worth of failing rows fills the front, so the call reaching them removes nobody while a due row stands
     behind them: a pass ending on that call, or reading the front again, never reaches that row. */
  it("goes on past a call that removed nobody to the due rows behind it", async () => {
    adresswechselAnswer = vorneDann(ORT_ADRESSE, entfernt(0, 43, ORT_ADRESSE), entfernt(1, 42), entfernt(0, 43));

    await runBewerbungSweep();

    // A warning, the half leaving rows it failed: a level above INFO would drop the line counting them.
    assert.deepEqual(
      lines.filter(({ level, event }) => level !== "error" && !SEASON_HALVES.test(event)),
      [
        {
          level: "warn",
          event: "adresswechsel.sweep_pass",
          fields: { entfernt: 1, wirksam: 0, verworfen: 0, verbleibend: 42 },
        },
      ],
    );
  });

  /* Each call counts every lapsed change standing, an earlier page's failures among them, so the pass's remainder is
     the last call's: a sum would count the first page's unreached rows as left behind. */
  it("warns with the last call's remainder of a pass over two pages, never a sum of them", async () => {
    adresswechselAnswer = inTurn([entfernt(2, 5, ORT_ADRESSE), entfernt(3, 1)]);

    await runBewerbungSweep();

    assert.deepEqual(
      lines.filter(({ event }) => event.startsWith("adresswechsel.")),
      [
        {
          level: "warn",
          event: "adresswechsel.sweep_pass",
          fields: { entfernt: 5, wirksam: 0, verworfen: 0, verbleibend: 1 },
        },
      ],
    );
  });

  /* A place not past the one sent holds the pass, and every clock behind it, for ever. Each double ends on its third
     answer, so a loop lacking the guard fails on its calls and lines rather than hanging. */
  for (const [wie, adresse] of [
    ["the same place", ORT_ADRESSE],
    ["a place before it", `${"d".repeat(23)}3`],
  ] as const) {
    it(`stops where a call answers ${wie}, the removals counted and the half's own line filed`, async () => {
      adresswechselAnswer = inTurn([entfernt(2, 5, ORT_ADRESSE), entfernt(1, 4, adresse), entfernt(0, 0)]);

      await runBewerbungSweep();

      expect(halfCalls()).toStrictEqual([{}, { nach: ORT_ADRESSE }]);
      expect(lines.filter(({ event }) => event.startsWith("adresswechsel."))).toStrictEqual([
        { level: "info", event: "adresswechsel.sweep_pass", fields: { entfernt: 3, wirksam: 0, verworfen: 0 } },
        {
          level: "error",
          event: "adresswechsel.sweep_failed",
          fields: { name: "ContractBreakError", saison_id: undefined },
        },
      ]);
    });
  }

  it("files a half that threw under its own line, the seasons swept before it", async () => {
    sweepAnswers({ saisonIds: ["2627"] });
    adresswechselAnswer = () => {
      throw new Error("the lapsed addresses were refused");
    };

    await runBewerbungSweep();

    assert.deepEqual([...seasonPasses(), ...registrierungPasses()].map(saisonOf), ["2627", "2627"]);
    assert.deepEqual(
      lines.filter(({ level }) => level === "error"),
      [
        {
          level: "error",
          event: "adresswechsel.sweep_failed",
          fields: { name: "Error", saison_id: undefined },
        },
      ],
    );
  });

  /* What an operator reads to learn the half ran and what it did: counts and nothing else, never a person, an address
     or an id. */
  it("writes one line per pass, holding its counts and nothing else", async () => {
    adresswechselAnswer = () => entfernt(2, 0);

    await runBewerbungSweep();

    assert.deepEqual(
      lines.filter(({ level, event }) => level === "info" && !SEASON_HALVES.test(event)),
      [{ level: "info", event: "adresswechsel.sweep_pass", fields: { entfernt: 2, wirksam: 0, verworfen: 0, verbleibend: 0 } }],
    );
  });

  /** An owed notice of each kind, as the pass's own effects and refusals queue them. */
  const wirksamFuer = (id: string, bisherige: string, neu: string): Owed => ({
    id: id,
    art: "wirksam",
    bisherige_email: bisherige,
    email: neu,
    vorname: null,
    weg: "wartezeit",
    aufgegeben: false,
  });
  const verworfenFuer = (id: string, email: string): Owed => ({
    id: id,
    art: "verworfen",
    bisherige_email: null,
    email: email,
    vorname: null,
    weg: null,
    aufgegeben: false,
  });

  /* The outbox, not the answer, is where a replaced address survives its change's effect: each is mailed its completion
     notice naming no new address, one refused send costs the others nothing, and only what left is stamped. */
  it("delivers every notice the outbox owes after the pass, stamping what left and leaving a refused one owed", async () => {
    refused.add("alt-1@schule.de");
    adresswechselAnswer = () => entfernt(1, 0, null, 2, 1);
    owed = [
      wirksamFuer(`${"e".repeat(23)}1`, "alt-1@schule.de", "neu-1@schule.de"),
      wirksamFuer(`${"e".repeat(23)}2`, "alt-2@schule.de", "neu-2@schule.de"),
      verworfenFuer(`${"e".repeat(23)}3`, "abgelehnt@schule.de"),
    ];

    await runBewerbungSweep();

    const notices = events.flatMap((event) => (event.kind === "mail" && event.subject.endsWith("wurde geändert") ? [event] : []));
    assert.deepEqual(
      notices.map(({ to }) => to),
      ["alt-1@schule.de", "alt-2@schule.de"],
    );
    assert.ok(
      notices.every(({ text }) => !text.includes("token=")),
      "a completion notice carries a link",
    );
    assert.ok(
      notices.every(({ text }) => !text.includes("neu-1@schule.de") && !text.includes("neu-2@schule.de")),
      "a completion notice names the new address",
    );
    assert.deepEqual(stamps, [{ beanspruchung: "claim-1", ids: [`${"e".repeat(23)}2`, `${"e".repeat(23)}3`] }]);
    assert.deepEqual(
      lines.filter(({ event }) => event === "adresswechsel.sweep_pass").map(({ fields }) => fields),
      [{ entfernt: 1, wirksam: 2, verworfen: 1, verbleibend: 0 }],
    );
  });

  /* A due change the pass refused leaves the new mailbox waiting on nothing: it is told, by no name. */
  it("mails the new address of every due change the pass refused a nameless notice", async () => {
    owed = [verworfenFuer(`${"e".repeat(23)}1`, "abgelehnt-1@schule.de"), verworfenFuer(`${"e".repeat(23)}2`, "abgelehnt-2@schule.de")];

    await runBewerbungSweep();

    const notices = events.flatMap((event) => (event.kind === "mail" && event.subject.endsWith("wurde nicht geändert") ? [event] : []));
    assert.deepEqual(
      notices.map(({ to }) => to),
      ["abgelehnt-1@schule.de", "abgelehnt-2@schule.de"],
    );
    assert.ok(
      notices.every(({ text }) => !/Hallo [A-ZÄÖÜ]/.test(text)),
      "the notice greets the new mailbox by a name",
    );
  });

  /* A confirmation's or an approval's notice whose answer was lost waits in the outbox: a half that failed must not
     hold it back another hour. */
  it("drains the outbox where the half threw", async () => {
    adresswechselAnswer = () => {
      throw new Error("the lapsed addresses were refused");
    };
    owed = [wirksamFuer(`${"e".repeat(23)}1`, "alt-1@schule.de", "neu-1@schule.de")];

    await runBewerbungSweep();

    assert.deepEqual(stamps, [{ beanspruchung: "claim-1", ids: [`${"e".repeat(23)}1`] }]);
  });

  /* Given up by the backend's count: stamped unsent, and the line names its kind and no address. */
  it("stamps an abandoned notice unsent, logging its kind and never its address", async () => {
    owed = [{ ...wirksamFuer(`${"e".repeat(23)}1`, "alt-1@schule.de", "neu-1@schule.de"), aufgegeben: true }];

    await runBewerbungSweep();

    assert.deepEqual(
      events.filter(({ kind }) => kind === "mail"),
      [],
    );
    assert.deepEqual(stamps, [{ beanspruchung: "claim-1", ids: [`${"e".repeat(23)}1`] }]);
    assert.deepEqual(
      lines.filter(({ event }) => event === "adresswechsel.notice_abandoned"),
      [{ level: "error", event: "adresswechsel.notice_abandoned", fields: { art: "wirksam" } }],
    );
  });
});
