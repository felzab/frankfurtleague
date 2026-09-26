import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it, mock } from "node:test";

import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { SentMail } from "@/core/mailDouble.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One thing that happened, in the order it happened: the two orderings this slice owes are orderings between the two kinds. */
type SweepEvent =
  { kind: "api"; endpoint: string; method: string; params?: Record<string, string>; body?: string } | ({ kind: "mail" } & SentMail);

const events: SweepEvent[] = [];
/** Addresses the doubled provider refuses, so a deletion notice can fail for one application alone. */
const refused = new Set<string>();

/** One failure line, as an operator reads it: which half stopped, and for which season. */
type SweepLog = { event: string; saison_id: string | undefined };

const logs: SweepLog[] = [];

const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flSweepLogs = logs;
recorders.__flSweepSwitch = "on";

let apiAnswer: (call: ApiEvent) => unknown = () => ({});

// Replaced at the module boundary rather than the sweep being reshaped to admit a seam: the real
// client reaches a backend no test process runs, and the real transport posts on a key none holds.
doubleApiClient(({ endpoint, method, params, body }, schema) => {
  // Into the one ordered list the mail double appends to, so a read and a send stay in the order they ran.
  const call: ApiEvent = { kind: "api", endpoint, method: method ?? "GET", params: params as ApiEvent["params"], body };
  events.push(call);
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the caller is written against.
  return schema.parse(apiAnswer(call));
});

const mail = doubleSendMail();

// The error arm records: which EVENT a failure is filed under is what tells an operator which half
// of a season's pass stopped, and that is a line rather than a call the transport shows.
const LOGGING_DOUBLE = `export const logger = {
  info: () => {},
  warn: () => {},
  error: (event, _message, fields) => globalThis.__flSweepLogs.push({ event, saison_id: fields?.saison_id }),
};`;

// A getter, not a value: one process holds one module registry, so a case that could not re-read the
// switch could only ever prove one side of it.
const CONFIG_DOUBLE = `export const frontend_config = {
  LOG_FORMAT: "console",
  AUTH_URL: "http://localhost:3000",
  get BEWERBUNG_SWEEP() { return globalThis.__flSweepSwitch; },
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { register } = await import("../../instrumentation.ts");
const { runBewerbungSweep } = await import("./sweep.ts");
const { FLBewerbungSweepLoeschungSchema } = await import("./schemas.ts");

/** One hour and one minute, as the arming spells them. */
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Lets every pending promise settle: a tick runs the callback, and the pass it starts finishes on the microtask queue. */
const settle = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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
  benachrichtigt = {},
}: {
  saisonIds?: string[];
  erinnerungen?: Record<string, unknown[]>;
  loeschungen?: Record<string, unknown[]>;
  registrierungErinnerungen?: Record<string, unknown[]>;
  benachrichtigt?: Record<string, unknown[]>;
}): void {
  answerWith((call) => {
    const saisonId = saisonOf(call);
    if (call.method === "GET") {
      return { acknowledged: 1, saison_ids: saisonIds, sweep_gelaufen_am: null, registrierung_sweep_gelaufen_am: null };
    }
    if (call.endpoint === "/bewerbungen/zustellung/angenommen") return { acknowledged: 1, angewendet: ["ansprechperson"] };
    if (call.endpoint === "/zustellung/angenommen") return { acknowledged: 1, angewendet: true };
    if (call.endpoint.endsWith("/angekuendigt")) return { acknowledged: 1, saison_id: saisonId, angekuendigt: 1 };
    if (call.endpoint.endsWith("/loeschen")) return { acknowledged: 1, saison_id: saisonId, geloescht: 1, redigierte_aktionen: 1 };
    if (call.endpoint.startsWith("/registrierungen/sweep/")) {
      return {
        acknowledged: 1,
        saison_id: saisonId,
        erinnerungen: registrierungErinnerungen[saisonId] ?? [],
        benachrichtigt: benachrichtigt[saisonId] ?? [],
        geloescht_unbestaetigt: 0,
        geloescht_ohne_entscheidung: 0,
        geloescht_abgelehnt: 0,
        redigierte_aktionen: 0,
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
  refused.clear();
  // Appended as the send happens, so a send and the calls around it stay in the order they ran.
  mail.answerWith((sent) => {
    events.push({ kind: "mail", ...sent });
    return refused.has(sent.to) ? "refused" : "accepted";
  });
  recorders.__flSweepSwitch = "on";
  sweepAnswers({});
});

describe("the switch the retention sweep is armed by", () => {
  /** The whole environment `createEnv` needs, so the case under test is the only variable in it. */
  const COMPLETE_ENV: Record<string, string> = {
    APP_ENV: "production",
    API_URL: "http://backend:8000",
    API_VERSION: "0",
    MONGODB_URI: "mongodb://localhost:27017/probe",
    AUTH_URL: "http://localhost:3000",
    // Long enough for the signing floor the parse applies: a shorter placeholder fails the whole
    // environment, and every case here would then report the switch as unreadable.
    AUTH_SECRET: "s".repeat(32),
    AUTH_RESEND_KEY: "resend",
    // The prefix is the whole of what the schema judges, so a placeholder carrying it is enough.
    RESEND_WEBHOOK_SECRET: "whsec_probe",
    INTERNAL_API_KEY_BASE: "b".repeat(64),
    INTERNAL_API_KEY_SYSTEM: "s".repeat(64),
    INTERNAL_API_KEY_ADMIN: "a".repeat(64),
    ALLOWED_ADMIN_EMAILS: "admin@frankfurtleague.de",
    LOG_FORMAT: "console",
  };

  let probe = 0;

  /** The real module's own parse, with the gate the `test:base` script stands down put back up. */
  async function parseWith(value: string | undefined): Promise<{ BEWERBUNG_SWEEP: string }> {
    const before = { ...process.env };
    Object.assign(process.env, COMPLETE_ENV);
    delete process.env.SKIP_ENV_VALIDATION;
    if (value === undefined) delete process.env.BEWERBUNG_SWEEP;
    else process.env.BEWERBUNG_SWEEP = value;

    probe += 1;
    try {
      // A fresh module per case, and one the double above steps past, matching the bare path alone:
      // one registry entry would otherwise answer every case.
      const parsed = (await import(`../../core/config.ts?probe=${String(probe)}`)) as {
        frontend_config: { BEWERBUNG_SWEEP: string };
      };
      return parsed.frontend_config;
    } finally {
      for (const name of Object.keys(process.env)) delete process.env[name];
      Object.assign(process.env, before);
    }
  }

  it("leaves the sweep armed where the server sets nothing", async () => {
    assert.equal((await parseWith(undefined)).BEWERBUNG_SWEEP, "on");
  });

  it("reads off in either case", async () => {
    assert.equal((await parseWith("off")).BEWERBUNG_SWEEP, "off");
    assert.equal((await parseWith("OFF")).BEWERBUNG_SWEEP, "off");
  });

  it("refuses anything else by name, rather than reading it as one side or the other", async () => {
    await assert.rejects(parseWith("false"), (error: Error) => error.message.includes("BEWERBUNG_SWEEP"));
  });
});

describe("what register arms", () => {
  // Next declares `NODE_ENV` read-only, which is true of the value a build inlines and not of this
  // process's own environment: the arm under test is exactly the one only a test can move.
  const env = process.env as Record<string, string | undefined>;

  // One process holds one environment, so a case that left NODE_ENV where it put it would decide
  // every case after it.
  function underNodeEnv(value: string): () => void {
    const before = env.NODE_ENV;
    env.NODE_ENV = value;

    return () => {
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    };
  }

  /** One arming and three hours of ticks: every case below asks only whether anything reached the backend at all. */
  async function armAndTick(nodeEnv: string, sweep: string | undefined): Promise<void> {
    const restore = underNodeEnv(nodeEnv);
    recorders.__flSweepSwitch = sweep;
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

    try {
      await register();
      await settle();
      mock.timers.tick(HOUR_MS * 3);
      await settle();
    } finally {
      mock.timers.reset();
      restore();
    }
  }

  /* The switch defaults to on and the `dev` script in `fl_frontend/package.json` sets nothing, so
     without this arm a `pnpm dev` drives the sweep against whatever backend and transport the
     developer's own environment names — the league's real people among them. */
  it("arms nothing under a development build, whatever the switch says", async () => {
    await armAndTick("development", "on");

    assert.deepEqual(events, []);
  });

  it("arms nothing where the switch is off", async () => {
    await armAndTick("production", "off");

    assert.deepEqual(events, []);
  });

  it("arms nothing where the value is missing, which is what a skipped validation leaves", async () => {
    await armAndTick("production", undefined);

    assert.deepEqual(events, []);
  });

  /* The fourth arm — a server setting nothing at all — is this case and the parse above it together:
     the default reads "on", and "on" under a production build is what arms. */
  it("runs one pass a minute after start and one an hour after arming", async () => {
    const restore = underNodeEnv("production");
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

    try {
      await register();
      await settle();
      const atOnce = apiCalls().length;

      mock.timers.tick(MINUTE_MS);
      await settle();
      const afterTheMinute = apiCalls().length;

      mock.timers.tick(HOUR_MS - MINUTE_MS - 1000);
      await settle();
      const beforeTheHour = apiCalls().length;

      mock.timers.tick(1000);
      await settle();
      const afterTheHour = apiCalls().length;

      assert.equal(atOnce, 0, "nothing runs at arming: the backend may not answer yet after a deploy");
      assert.equal(afterTheMinute, 1, "the first pass runs a minute in, a container recreated daily never reaching the first tick");
      assert.equal(beforeTheHour, 1, "nothing runs between the first pass and the hour");
      assert.equal(afterTheHour, 2, "the interval is one hour, measured from arming");
    } finally {
      mock.timers.reset();
      restore();
    }
  });
});

describe("one pass of the sweep", () => {
  it("calls the backend once per season", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await runBewerbungSweep();

    assert.deepEqual(seasonPasses().map(saisonOf), ["2526", "2627"]);
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

    assert.deepEqual(
      events.map((event) => event.kind),
      // The fourth is the accepted send recording itself, which follows the message rather than
      // preceding it: no id exists to record until the provider has answered. The fifth is the
      // registration pass, which closes every season.
      ["api", "api", "mail", "api", "api"],
    );
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
    assert.equal(reminder?.text.match(/\/bestaetigung\/kontakt\?token=/g)?.length, 1, "the paired mailbox was sent a second link");
    // The CONFIGURED origin and never the published one (`docs/frontend/spec.md :: I186`).
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
    assert.deepEqual(
      events.map((event) => event.kind),
      // The record after the delivered notice, and none after the refused one; the registration
      // pass closes the season.
      ["api", "api", "mail", "api", "mail", "api", "api", "api"],
      "both notices go out before anything is stamped or erased",
    );
    assert.equal(stamp?.endpoint, "/bewerbungen/sweep/2627/angekuendigt");
    assert.deepEqual(JSON.parse(stamp?.body ?? "{}"), { bewerbung_ids: [ID_REACHED] });
    assert.equal(erasure?.endpoint, "/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_REACHED] });
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
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "api", "api"],
      "an announced candidate was mailed or stamped again",
    );
    assert.equal(erasure?.endpoint, "/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_REACHED] });
  });

  /* Two ticks over one pass would compose the same notice twice, neither having reached its stamp.
     One process holds one timer, so this refuses an overlap rather than a second container. */
  it("skips a tick that finds the previous pass still running", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await Promise.all([runBewerbungSweep(), runBewerbungSweep()]);

    assert.deepEqual(seasonPasses().map(saisonOf), ["2526", "2627"]);
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
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "api", "api", "api"],
      "no message is composed for a candidate with no address",
    );
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_NOBODY] });
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

    assert.equal(events.filter((event) => event.kind === "mail").length, 2, "a listed candidate was held back on this side");
    assert.deepEqual(JSON.parse(callTo("/bewerbungen/sweep/2627/loeschen")?.body ?? "{}"), { bewerbung_ids: [ID_REACHED, ID_SILENT] });
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

    assert.equal(reminder?.idempotencyKey, undefined, "the reminder mints a fresh token, so a reused key would be refused over a changed body");
    assert.match(String(noticeMail?.idempotencyKey), /^loeschung_/);
    assert.deepEqual(reminder?.tags, { bewerbung_id: ID_REACHED, rollen: "ansprechperson", anlass: "erinnerung" });
    assert.deepEqual(noticeMail?.tags, { bewerbung_id: ID_SILENT, rollen: "ansprechperson", anlass: "loeschung" });
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
      };
    });

    await runBewerbungSweep();

    assert.deepEqual(seasonPasses().map(saisonOf), ["2526", "2627"]);
  });
});

/** Registration ids as the mirror demands them: `CustomObjectIdStringSchema` takes 24 hex characters and nothing else. */
const ID_PUPIL = `${"d".repeat(23)}4`;
const ID_UNDECIDED = `${"e".repeat(23)}5`;

const reminder = (registrierungId: string, email: string, token: string) => ({
  registrierung_id: registrierungId,
  saison_id: "2627",
  team: "Adler",
  vorname: "Quillhilde",
  email: email,
  token: token,
});

const notice = (registrierungId: string, email: string) => ({
  registrierung_id: registrierungId,
  saison_id: "2627",
  team: "Adler",
  vorname: "Quillhilde",
  email: email,
});

describe("the registration half of one pass", () => {
  /* The detail the shape invites getting wrong: the application half returns early where it has
     nothing to erase, and a registration call inside that arm runs for no season with a quiet queue. */
  it("runs for a season whose application half erased nothing at all", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await runBewerbungSweep();

    assert.deepEqual(registrierungPasses().map(saisonOf), ["2526", "2627"]);
  });

  it("runs after the application's own pass, whose call stamps the day", async () => {
    sweepAnswers({ saisonIds: ["2627"] });

    await runBewerbungSweep();

    assert.deepEqual(
      apiCalls().map((call) => call.endpoint),
      ["/bewerbungen/sweep", "/bewerbungen/sweep/2627", "/registrierungen/sweep/2627"],
    );
  });

  it("mails the pupil's reminder with the fresh link and no idempotency key", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      registrierungErinnerungen: { "2627": [reminder(ID_PUPIL, "quillhilde@schule.de", "token-frisch")] },
    });

    await runBewerbungSweep();

    const chase = events.find((event) => event.kind === "mail");
    assert.equal(chase?.to, "quillhilde@schule.de");
    // The CONFIGURED origin and never the published one: a link built on the latter sends a reader
    // of this stack into production (`docs/frontend/spec.md :: I186`).
    assert.ok(
      chase?.text.includes("http://localhost:3000/bestaetigung/spieler?token=token-frisch"),
      "the message carries the link the pass just minted, on the origin this run is configured with",
    );
    // The window the first message named: the sentence says the deadline has not moved, and seven is
    // the mirrored bound rather than a number this file spells.
    assert.ok(chase?.text.includes("7 Tagen"), "the reminder states the window the first message named");
    assert.equal(chase?.idempotencyKey, undefined, "a fresh token in the body makes a reused key a refusal rather than a collapse");
    assert.deepEqual(chase?.tags, { ziel: "registrierung", ziel_id: ID_PUPIL, anlass: "erinnerung" });
  });

  /* No pre-notice and one note after: the row is erased by the call that answered this list, so the
     message reports rather than asks, and its body cannot change inside the provider's window. */
  it("mails the season-end note after the erasure, keyed on the day", async () => {
    sweepAnswers({ saisonIds: ["2627"], benachrichtigt: { "2627": [notice(ID_UNDECIDED, "quillhilde@schule.de")] } });

    await runBewerbungSweep();

    assert.deepEqual(
      events.map((event) => event.kind),
      // The erasure is behind the second call already; the record after the message is the accepted
      // send, which reaches no row and is filed as such.
      ["api", "api", "api", "mail", "api"],
    );
    const note = events.find((event) => event.kind === "mail");
    assert.match(String(note?.idempotencyKey), /^loeschung_registrierung_/);
    assert.deepEqual(note?.tags, { ziel: "registrierung", ziel_id: ID_UNDECIDED, anlass: "loeschung" });
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
      };
    });

    await runBewerbungSweep();

    assert.equal(stamped.bewerbung, "2026-09-21", "the application's pass was abandoned with the registration's");
    assert.equal(stamped.registrierung, null);
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
      };
    });

    await runBewerbungSweep();

    assert.deepEqual(registrierungPasses().map(saisonOf), ["2627"]);
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
      };
    });

    await runBewerbungSweep();

    assert.deepEqual(logs, [
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
      };
    });

    await runBewerbungSweep();

    assert.deepEqual(registrierungPasses().map(saisonOf), ["2526", "2627"]);
  });
});
