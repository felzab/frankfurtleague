import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, beforeEach, describe, it, mock } from "node:test";

import { ACTOR_KEY_FILE } from "@/core/authDoubles.ts";
import { APIBadStatusError } from "@/core/errors.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { SentMail } from "@/core/mailDouble.ts";

/** One thing that happened, in the order it happened: the two orderings this slice owes are orderings between the two kinds. */
type SweepEvent =
  { kind: "api"; endpoint: string; method: string; params?: Record<string, string | null>; body?: string } | ({ kind: "mail" } & SentMail);

const events: SweepEvent[] = [];
/** Addresses the doubled provider refuses, so a deletion notice can fail for one application alone. */
const refused = new Set<string>();
const withheld = new Set<string>();

/** One failure line, as an operator reads it: which half stopped, and for which season. */
type SweepLog = { event: string; saison_id: string | undefined };

const logs: SweepLog[] = [];

/** Every line as it was written, its fields whole: what a half reports per pass, and the code its failure carries. */
const lines: { level: "info" | "error"; event: string; fields: unknown }[] = [];

/** The sweep's switch as the doubled config answers it, which a case sets. */
let sweepSwitch: string | undefined = "on";
/** The pupils' deletion switch, off where a case sets nothing, as production's default is. */
let loeschungSwitch: string | undefined = "off";
let appEnv = "production";

let apiAnswer: (call: ApiEvent) => unknown = () => ({});

const ADRESSWECHSEL = "/schiedsrichter/sweep/adresswechsel";
const LAUF = "/identitaet/loeschung/lauf";

/**
 * The two halves after the season loop, answered apart so a case about a season's clocks never answers them. Each is
 * handed the place its call carried, null on a pass's first.
 */
let adresswechselAnswer: (nach: string | null) => unknown = () => entfernt(0, 0);
let laufAnswer: (nach: string | null) => unknown = () => gelaufen(0, 0);

/** One call of the lapsed addresses' half: how many went, how many are still due, and where the pass goes on. */
const entfernt = (anzahl: number, verbleibend: number, nach: string | null = null) => ({
  acknowledged: 1,
  entfernt: anzahl,
  verbleibend: verbleibend,
  nach: nach,
});

/** One call of the pupils' deletion: whom it erased, who is still due after it, and where the pass goes on. */
const gelaufen = (spieler: number, verbleibend: number, nach: string | null = null) => ({
  acknowledged: 1,
  abgeschlossene_saison_id: "2526",
  spieler: spieler,
  saison_spieler: spieler,
  registrierungen: 0,
  uebersprungen: 0,
  fehlgeschlagen: 0,
  verbleibend: verbleibend,
  nach: nach,
});

/** The grants' claim with nothing to announce. */
const NOTHING_CLAIMED = { acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 };

// Replaced at the module boundary rather than the sweep being reshaped to admit a seam: the real
// client reaches a backend no test process runs, and the real transport posts on a key none holds.
doubleApiClient(({ endpoint, method, params, body }, schema) => {
  // The grants' pass is armed by the same boot and answers to its own suite
  // (`fl_frontend/src/features/berechtigungen/abgleich.test.ts`): here it claims nothing and is not recorded.
  if (endpoint.startsWith("/berechtigungen")) return schema.parse(NOTHING_CLAIMED);
  // Into the one ordered list the mail double appends to, so a read and a send stay in the order they ran.
  const call: ApiEvent = { kind: "api", endpoint, method: method ?? "GET", params: params as ApiEvent["params"], body };
  events.push(call);
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the caller is written against.
  if (endpoint === ADRESSWECHSEL) return schema.parse(adresswechselAnswer(call.params?.nach ?? null));
  if (endpoint === LAUF) return schema.parse(laufAnswer(call.params?.nach ?? null));
  return schema.parse(apiAnswer(call));
});

const mail = doubleSendMail();

// The error arm records: which EVENT a failure is filed under is what tells an operator which half
// of a season's pass stopped, and that is a line rather than a call the transport shows.
const LOGGING_DOUBLE = {
  logger: {
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: () => undefined,
    error: (event: string, _message: unknown, fields?: { saison_id?: string }) => {
      logs.push({ event, saison_id: fields?.saison_id });
      lines.push({ level: "error", event, fields });
    },
  },
};

// A getter, not a value: one process holds one module registry, so a case that could not re-read the
// switch could only ever prove one side of it.
const CONFIG_DOUBLE = {
  frontend_config: {
    LOG_FORMAT: "console",
    AUTH_URL: "http://localhost:3000",
    // The boot reads the signing key before it arms anything.
    ACTOR_SIGNING_KEY_FILE: ACTOR_KEY_FILE,
    get BEWERBUNG_SWEEP() {
      return sweepSwitch;
    },
    get LOESCHUNG_SWEEP() {
      return loeschungSwitch;
    },
    get APP_ENV() {
      return appEnv;
    },
  },
};

const INDEXES_DOUBLE = { buildAuthIndexes: () => Promise.resolve() };

registerDoubles({
  modules: {
    "core/logging.ts": LOGGING_DOUBLE,
    "core/config.ts": CONFIG_DOUBLE,
    // A production boot builds the sign-in store's indexes too, over a client this suite never configures.
    "core/authIndexes.ts": INDEXES_DOUBLE,
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
  lines.length = 0;
  refused.clear();
  withheld.clear();
  // Appended as the send happens, so a send and the calls around it stay in the order they ran.
  mail.answerWith((sent) => {
    events.push({ kind: "mail", ...sent });
    return refused.has(sent.to) ? "refused" : withheld.has(sent.to) ? "withheld" : "accepted";
  });
  sweepSwitch = "on";
  loeschungSwitch = "off";
  appEnv = "production";
  sweepAnswers({});
  adresswechselAnswer = () => entfernt(0, 0);
  laufAnswer = () => gelaufen(0, 0);
});

describe("the switch the retention sweep is armed by", () => {
  /** The whole environment `createEnv` needs, so the case under test is the only variable in it. */
  const COMPLETE_ENV: Record<string, string> = {
    APP_ENV: "production",
    API_URL: "http://backend:8000",
    API_VERSION: "0",
    AUTH_URL: "http://localhost:3000",
    LOG_FORMAT: "console",
    // Of no published test key's shape, which production refuses.
    TURNSTILE_SITE_KEY: "fabricated-site-key",
  };

  /** And every secret file it reads, by the file's own name. */
  const SECRETS_DIR = mkdtempSync(path.join(tmpdir(), "fl-sweep-secrets-"));
  after(() => rmSync(SECRETS_DIR, { recursive: true, force: true }));
  for (const [name, value] of Object.entries({
    frontend_mongodb_uri: "mongodb://localhost:27017/probe",
    // Long enough for the signing floor the parse applies: a shorter placeholder fails the whole
    // environment, and every case here would then report the switch as unreadable.
    auth_secret: "s".repeat(32),
    auth_resend_key: "resend",
    // The prefix is the whole of what the schema judges, so a placeholder carrying it is enough.
    resend_webhook_secret: "whsec_probe",
    internal_api_key_base: "b".repeat(64),
    internal_api_key_system: "s".repeat(64),
    internal_api_key_admin: "a".repeat(64),
    turnstile_secret_key: "fabricated-turnstile-secret",
  })) {
    writeFileSync(path.join(SECRETS_DIR, name), value);
  }

  let probe = 0;

  /** The real module's own parse of one switch, with the gate the `test:base` script stands down put back up. */
  async function parseWith(
    value: string | undefined,
    variable: "BEWERBUNG_SWEEP" | "LOESCHUNG_SWEEP" = "BEWERBUNG_SWEEP",
  ): Promise<Record<"BEWERBUNG_SWEEP" | "LOESCHUNG_SWEEP", string>> {
    const before = { ...process.env };
    Object.assign(process.env, COMPLETE_ENV, { SECRETS_DIR });
    delete process.env.SKIP_ENV_VALIDATION;
    delete process.env.BEWERBUNG_SWEEP;
    delete process.env.LOESCHUNG_SWEEP;
    if (value !== undefined) process.env[variable] = value;

    probe += 1;
    try {
      // A fresh module per case, and one the double above steps past, matching the bare path alone:
      // one registry entry would otherwise answer every case.
      const parsed = (await import(`../../core/config.ts?probe=${String(probe)}`)) as {
        frontend_config: Record<"BEWERBUNG_SWEEP" | "LOESCHUNG_SWEEP", string>;
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

  /* The pupils' deletion: off by default, so the first activation after a deploy deletes nobody until an operator
     has read the season page's count and turned it on. */
  describe("and the switch the pupils' deletion is armed by", () => {
    it("leaves the deletion off where the server sets nothing", async () => {
      assert.equal((await parseWith(undefined, "LOESCHUNG_SWEEP")).LOESCHUNG_SWEEP, "off");
    });

    it("reads on in either case", async () => {
      assert.equal((await parseWith("on", "LOESCHUNG_SWEEP")).LOESCHUNG_SWEEP, "on");
      assert.equal((await parseWith("ON", "LOESCHUNG_SWEEP")).LOESCHUNG_SWEEP, "on");
    });

    it("refuses anything else by name, rather than reading it as one side or the other", async () => {
      await assert.rejects(parseWith("false", "LOESCHUNG_SWEEP"), (error: Error) => error.message.includes("LOESCHUNG_SWEEP"));
    });
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
    sweepSwitch = sweep;
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
    // By its season-list read: the halves after the season loop add calls of their own to every pass.
    const passes = (): number => apiCalls().filter((call) => call.method === "GET" && call.endpoint === "/bewerbungen/sweep").length;

    try {
      await register();
      await settle();
      const atOnce = passes();

      mock.timers.tick(MINUTE_MS);
      await settle();
      const afterTheMinute = passes();

      mock.timers.tick(HOUR_MS - MINUTE_MS - 1000);
      await settle();
      const beforeTheHour = passes();

      mock.timers.tick(1000);
      await settle();
      const afterTheHour = passes();

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
      // The fourth is the accepted send recording itself, after the message: no id exists to record
      // until the provider has answered. The fifth is the registration pass closing every season, the
      // last the lapsed addresses' half.
      ["api", "api", "mail", "api", "api", "api"],
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
      // pass closes the season, and the lapsed addresses' half the pass.
      ["api", "api", "mail", "api", "mail", "api", "api", "api", "api"],
      "both notices go out before anything is stamped or erased",
    );
    assert.equal(stamp?.endpoint, "/bewerbungen/sweep/2627/angekuendigt");
    assert.deepEqual(JSON.parse(stamp?.body ?? "{}"), { bewerbung_ids: [ID_REACHED] });
    assert.equal(erasure?.endpoint, "/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_REACHED] });
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

      assert.equal(events.filter((event) => event.kind === "mail").length, 1, "the notice was never sent, so nothing was filed");
      const stamp = callTo("/bewerbungen/sweep/2627/angekuendigt");
      const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
      assert.deepEqual(
        [stamp, erasure].map((call) => (call === undefined ? null : JSON.parse(call.body ?? "{}"))),
        erased ? [{ bewerbung_ids: [ID_REACHED] }, { bewerbung_ids: [ID_REACHED] }] : [null, null],
      );
    });
  }

  /* On production too: a barred mailbox is as told as the league may make it, and waiting on a send
     the ban never lets out would keep the application for as long as the ban stands
     (`docs/frontend/spec.md :: I538`). */
  it("stamps and erases a candidate whose one mailbox the ban list holds, on production", async () => {
    mail.answerWith((sent) => {
      events.push({ kind: "mail", ...sent });
      return "barred";
    });
    sweepAnswers({ saisonIds: ["2627"], loeschungen: { "2627": [deletion(ID_REACHED, "erika@schule.de")] } });

    await runBewerbungSweep();

    assert.equal(events.filter((event) => event.kind === "mail").length, 1, "the notice was never handed to the mailer");
    const stamp = callTo("/bewerbungen/sweep/2627/angekuendigt");
    const erasure = callTo("/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(
      [stamp, erasure].map((call) => (call === undefined ? null : JSON.parse(call.body ?? "{}"))),
      [{ bewerbung_ids: [ID_REACHED] }, { bewerbung_ids: [ID_REACHED] }],
    );
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
      ["api", "api", "api", "api", "api"],
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
      ["api", "api", "api", "api", "api", "api"],
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
      ["/bewerbungen/sweep", "/bewerbungen/sweep/2627", "/registrierungen/sweep/2627", ADRESSWECHSEL],
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
      // send, which reaches no row and is filed as such, and the lapsed addresses' half ends the pass.
      ["api", "api", "api", "mail", "api", "api"],
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

    assert.deepEqual(
      lines.filter(({ level }) => level === "error").map(({ fields }) => fields),
      [
        {
          error_code: "FE-SWEEP-001",
          name: "APIBadStatusError",
          status: 500,
          server_error_code: "DB-FAIL-001",
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          saison_id: undefined,
        },
      ],
    );
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

describe("the two halves after the season loop", () => {
  /** The calls of the lapsed addresses' half and of the pupils' half, in the order they ran. */
  const halves = (): string[] =>
    apiCalls()
      .map((call) => call.endpoint)
      .filter((endpoint) => endpoint === ADRESSWECHSEL || endpoint === LAUF);

  /** Answers each call with the next of `answers`, the last one standing for every call after it. */
  const inTurn = <T>(answers: T[]) => {
    let turn = 0;
    return (): T => answers[Math.min(turn++, answers.length - 1)] as T;
  };

  /* A lapsed address is a stranger's mailbox kept past its day: no switch holds it back, and no season reaches it.
     Unset is what a skipped validation leaves, where a test negating "off" would delete. */
  for (const schalter of ["off", undefined]) {
    it(`removes the lapsed addresses on every pass after the seasons, and deletes no pupil while the switch reads ${String(schalter)}`, async () => {
      loeschungSwitch = schalter;
      sweepAnswers({ saisonIds: ["2627"] });

      await runBewerbungSweep();

      assert.deepEqual(
        apiCalls().map((call) => call.endpoint),
        ["/bewerbungen/sweep", "/bewerbungen/sweep/2627", "/registrierungen/sweep/2627", ADRESSWECHSEL],
      );
    });
  }

  it("deletes the due pupils after the lapsed addresses where the switch reads on", async () => {
    loeschungSwitch = "on";

    await runBewerbungSweep();

    assert.deepEqual(halves(), [ADRESSWECHSEL, LAUF]);
  });

  /* Neither half takes a season, so a season list the backend could not answer leaves both to run. */
  it("runs both halves where the season list could not be read", async () => {
    loeschungSwitch = "on";
    answerWith(() => {
      throw new Error("the season list was refused");
    });

    await runBewerbungSweep();

    assert.deepEqual(halves(), [ADRESSWECHSEL, LAUF]);
  });

  /** Each call of the two halves with the parameters it carried, in the order they ran. */
  const halfCalls = (): [string, ApiEvent["params"]][] =>
    apiCalls()
      .filter(({ endpoint }) => endpoint === ADRESSWECHSEL || endpoint === LAUF)
      .map(({ endpoint, params }) => [endpoint, params]);

  /** Places in the `_id` order, as the mirror demands them. */
  const ORT_ADRESSE = `${"d".repeat(23)}4`;
  const ORT_SPIELER = `${"e".repeat(23)}5`;

  /* The pass is the caller's to hold: each call carries the place the call before it answered, and the first answer
     naming none ends it, whatever `verbleibend` still counts. */
  it("hands each call of a half the place the last answer named, and calls no further once one names none", async () => {
    loeschungSwitch = "on";
    // Each list closes on an answer naming no place, so a loop that ignores the end fails on its count rather than hanging.
    adresswechselAnswer = inTurn([entfernt(2, 1, ORT_ADRESSE), entfernt(1, 1), entfernt(4, 4)]);
    laufAnswer = inTurn([gelaufen(3, 2, ORT_SPIELER), gelaufen(2, 1), gelaufen(4, 4)]);

    await runBewerbungSweep();

    // A first call carrying no `nach` at all, never a null one: present, the server reads it as an id.
    assert.deepEqual(halfCalls(), [
      [ADRESSWECHSEL, {}],
      [ADRESSWECHSEL, { nach: ORT_ADRESSE }],
      [LAUF, {}],
      [LAUF, { nach: ORT_SPIELER }],
    ]);
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
    loeschungSwitch = "on";
    adresswechselAnswer = vorneDann(ORT_ADRESSE, entfernt(0, 43, ORT_ADRESSE), entfernt(1, 42), entfernt(0, 43));
    laufAnswer = vorneDann(ORT_SPIELER, { ...gelaufen(0, 11, ORT_SPIELER), fehlgeschlagen: 10 }, gelaufen(1, 10), gelaufen(0, 11));

    await runBewerbungSweep();

    assert.deepEqual(
      lines.filter(({ level }) => level === "info"),
      [
        { level: "info", event: "schiedsrichter.adresswechsel_sweep_pass", fields: { entfernt: 1, verbleibend: 42 } },
        {
          level: "info",
          event: "loeschung.sweep_pass",
          fields: {
            abgeschlossene_saison_id: "2526",
            spieler: 1,
            saison_spieler: 1,
            registrierungen: 0,
            uebersprungen: 0,
            fehlgeschlagen: 10,
            verbleibend: 10,
          },
        },
      ],
    );
  });

  /* Each half is its own clock: a shared `try` would hold every due pupil past the hour the address half fails. */
  it("deletes the due pupils where the lapsed addresses' half threw, the seasons swept before it, under the half's own line", async () => {
    loeschungSwitch = "on";
    sweepAnswers({ saisonIds: ["2627"] });
    adresswechselAnswer = () => {
      throw new Error("the lapsed addresses were refused");
    };

    await runBewerbungSweep();

    assert.deepEqual(halves(), [ADRESSWECHSEL, LAUF]);
    assert.deepEqual([...seasonPasses(), ...registrierungPasses()].map(saisonOf), ["2627", "2627"]);
    assert.deepEqual(
      lines.filter(({ level }) => level === "error"),
      [
        {
          level: "error",
          event: "schiedsrichter.adresswechsel_sweep_failed",
          fields: { error_code: "FE-SWEEP-001", name: "Error", saison_id: undefined },
        },
      ],
    );
  });

  it("files a failed pupils' half under its own line, the lapsed addresses removed before it", async () => {
    loeschungSwitch = "on";
    adresswechselAnswer = () => entfernt(1, 0);
    laufAnswer = () => {
      throw new Error("the deletion was refused");
    };

    await runBewerbungSweep();

    assert.deepEqual(halves(), [ADRESSWECHSEL, LAUF]);
    assert.deepEqual(
      lines.filter(({ level }) => level === "error"),
      [{ level: "error", event: "loeschung.sweep_failed", fields: { error_code: "FE-SWEEP-001", name: "Error", saison_id: undefined } }],
    );
  });

  /* What an operator reads to learn the halves ran and what they did: counts and the season the rule kept, never a
     person, an address or an id. */
  it("writes one line per pass for each half, holding its counts and nothing else", async () => {
    loeschungSwitch = "on";
    adresswechselAnswer = () => entfernt(2, 0);
    laufAnswer = inTurn([gelaufen(3, 1, ORT_SPIELER), gelaufen(1, 0)]);

    await runBewerbungSweep();

    assert.deepEqual(
      lines.filter(({ level }) => level === "info"),
      [
        { level: "info", event: "schiedsrichter.adresswechsel_sweep_pass", fields: { entfernt: 2, verbleibend: 0 } },
        {
          level: "info",
          event: "loeschung.sweep_pass",
          fields: {
            abgeschlossene_saison_id: "2526",
            spieler: 4,
            saison_spieler: 4,
            registrierungen: 0,
            uebersprungen: 0,
            fehlgeschlagen: 0,
            verbleibend: 0,
          },
        },
      ],
    );
  });
});
