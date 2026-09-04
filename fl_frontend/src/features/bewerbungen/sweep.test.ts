import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it, mock } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One thing that happened, in the order it happened: the two orderings this slice owes are orderings between the two kinds. */
type SweepEvent =
  | { kind: "api"; endpoint: string; method: string; authType?: string; params?: Record<string, string>; body?: string }
  | { kind: "mail"; to: string; subject: string; text: string };

const events: SweepEvent[] = [];
/** Addresses the doubled provider refuses, so a deletion notice can fail for one application alone. */
const refused = new Set<string>();

const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flSweepEvents = events;
recorders.__flSweepRefused = refused;
recorders.__flSweepSwitch = "on";
recorders.__flSweepAnswer = () => ({});

// Replaced at the module boundary rather than the sweep being reshaped to admit a seam: the real
// client reaches a backend no test process runs, and the real transport posts on a key none holds.
const API_DOUBLE = `export const apiClient = async (endpoint, schema, options = {}) => {
  const call = { kind: "api", endpoint, method: options.method ?? "GET", authType: options.authType, params: options.params, body: options.body };
  globalThis.__flSweepEvents.push(call);
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift
  // from the shape the caller is written against.
  return schema.parse(globalThis.__flSweepAnswer(call));
};`;

const MAIL_DOUBLE = `export const sendMail = async (mail) => {
  globalThis.__flSweepEvents.push({ kind: "mail", to: mail.to, subject: mail.subject, text: mail.text });
  if (globalThis.__flSweepRefused.has(mail.to)) throw new Error("the provider refused the message");
};`;

const LOGGING_DOUBLE = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;

// A getter, not a value: one process holds one module registry, so a case that could not re-read the
// switch could only ever prove one side of it.
const CONFIG_DOUBLE = `export const frontend_config = {
  LOG_FORMAT: "console",
  get BEWERBUNG_SWEEP() { return globalThis.__flSweepSwitch; },
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { register } = await import("../../instrumentation.ts");
const { runBewerbungSweep } = await import("./sweep.ts");

/** One hour and one minute, as the arming spells them. */
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Lets every pending promise settle: a tick runs the callback, and the pass it starts finishes on the microtask queue. */
const settle = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type ApiEvent = Extract<SweepEvent, { kind: "api" }>;

const apiCalls = (): ApiEvent[] => events.filter((event): event is ApiEvent => event.kind === "api");

/** The season a call addresses, which the contract puts in the path rather than in a parameter. */
const saisonOf = (call: ApiEvent): string => call.endpoint.split("/")[3] ?? "";

/** The season pass alone: the stamp and the erasure sit under the same prefix and would count as one. */
const seasonPasses = (): ApiEvent[] =>
  apiCalls().filter(
    (call) =>
      call.method === "POST" && !call.endpoint.endsWith("/loeschen") && !call.endpoint.endsWith("/angekuendigt") && saisonOf(call) !== "",
  );

function answerWith(answer: (call: ApiEvent) => unknown): void {
  recorders.__flSweepAnswer = answer;
}

/** One season's pass, with nothing for this side to do unless a case says otherwise. */
function sweepAnswers({
  saisonIds = [],
  erinnerungen = {},
  loeschungen = {},
}: {
  saisonIds?: string[];
  erinnerungen?: Record<string, unknown[]>;
  loeschungen?: Record<string, unknown[]>;
}): void {
  answerWith((call) => {
    const saisonId = saisonOf(call);
    if (call.method === "GET") return { acknowledged: 1, saison_ids: saisonIds };
    if (call.endpoint.endsWith("/angekuendigt")) return { acknowledged: 1, saison_id: saisonId, angekuendigt: 1 };
    if (call.endpoint.endsWith("/loeschen")) return { acknowledged: 1, saison_id: saisonId, geloescht: 1, redigierte_aktionen: 1 };

    return {
      acknowledged: 1,
      saison_id: saisonId,
      erinnerungen: erinnerungen[saisonId] ?? [],
      loeschungen: loeschungen[saisonId] ?? [],
      abgelehnte_geloescht: 0,
      angenommene_geloescht: 0,
      kontaktbloecke_geleert: 0,
      redigierte_aktionen: 0,
    };
  });
}

/** Application ids as the mirror demands them: `CustomObjectIdStringSchema` takes 24 hex characters and nothing else. */
const ID_ERREICHT = `${"a".repeat(23)}1`;
const ID_STUMM = `${"b".repeat(23)}2`;
const ID_NIEMAND = `${"c".repeat(23)}3`;

/** One deletion candidate nobody has been told about yet; a null address is the seat the erasure emptied. */
const loeschung = (bewerbungId: string, address: string | null, rollen: string[] = ["ansprechperson"]) => ({
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
  refused.clear();
  recorders.__flSweepSwitch = "on";
  sweepAnswers({});
});

describe("the switch the retention sweep is armed by", () => {
  /** The whole environment `createEnv` needs, so the case under test is the only variable in it. */
  const COMPLETE_ENV: Record<string, string> = {
    API_URL: "http://backend:8000",
    API_VERSION: "0",
    MONGODB_URI: "mongodb://localhost:27017/probe",
    AUTH_URL: "http://localhost:3000",
    AUTH_SECRET: "secret",
    AUTH_RESEND_KEY: "resend",
    INTERNAL_API_KEY_BASE: "b".repeat(64),
    INTERNAL_API_KEY_SYSTEM: "s".repeat(64),
    INTERNAL_API_KEY_ADMIN: "a".repeat(64),
    ALLOWED_ADMIN_EMAILS: "admin@frankfurtleague.de",
    LOG_FORMAT: "console",
  };

  let probe = 0;

  /** The real module's own parse, with the gate the `test` script stands down put back up. */
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
  it("calls the backend once per season, as the system", async () => {
    sweepAnswers({ saisonIds: ["2526", "2627"] });

    await runBewerbungSweep();

    assert.deepEqual(seasonPasses().map(saisonOf), ["2526", "2627"]);
    assert.deepEqual(new Set(apiCalls().map((call) => call.authType)), new Set(["system"]));
  });

  it("stamps the reminder before it mails it, so a refused address costs one reminder rather than a daily one", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      erinnerungen: {
        "2627": [
          {
            bewerbung_id: ID_ERREICHT,
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
      ["api", "api", "mail"],
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
            bewerbung_id: ID_ERREICHT,
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

    const erinnerung = events.find((event) => event.kind === "mail");
    assert.equal(erinnerung?.text.match(/\/bestaetigung\?token=/g)?.length, 1, "the paired mailbox was sent a second link");
    assert.ok(erinnerung?.text.includes("Ansprechperson und Trainerin oder Trainer"), "the one link names one of the two seats it answers");
  });

  it("mails the deletion notice, stamps what was delivered, and erases only that", async () => {
    refused.add("stumm@schule.de");
    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: {
        "2627": [loeschung(ID_ERREICHT, "erika@schule.de"), loeschung(ID_STUMM, "stumm@schule.de")],
      },
    });

    await runBewerbungSweep();

    const [stamp, erasure] = apiCalls().slice(-2);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "mail", "mail", "api", "api"],
      "both notices go out before anything is stamped or erased",
    );
    assert.equal(stamp?.endpoint, "/bewerbungen/sweep/2627/angekuendigt");
    assert.deepEqual(JSON.parse(stamp?.body ?? "{}"), { bewerbung_ids: [ID_ERREICHT] });
    assert.equal(erasure?.endpoint, "/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_ERREICHT] });
  });

  /* The pass after an erasure that failed: the candidate is listed again, already announced. Mailing
     it a second time is what the stamp exists to stop, and the erasure is retried on its own. */
  it("mails nothing for a candidate already announced, and erases it without a second stamp", async () => {
    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: { "2627": [{ ...loeschung(ID_ERREICHT, "erika@schule.de"), angekuendigt: true }] },
    });

    await runBewerbungSweep();

    const erasure = apiCalls().at(-1);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "api"],
      "an announced candidate was mailed or stamped again",
    );
    assert.equal(erasure?.endpoint, "/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_ERREICHT] });
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
      loeschungen: { "2627": [loeschung(ID_ERREICHT, "erika@schule.de", ["trainer", "ansprechperson"])] },
    });

    await runBewerbungSweep();

    const notiz = events.find((event) => event.kind === "mail");
    assert.ok(notiz?.text.includes("Ansprechperson und Trainerin oder Trainer"), "the notice names one of the two seats its reader holds");
  });

  it("erases a candidate whose Ansprechperson seat is empty, there being nobody left to tell", async () => {
    sweepAnswers({ saisonIds: ["2627"], loeschungen: { "2627": [loeschung(ID_NIEMAND, null)] } });

    await runBewerbungSweep();

    const erasure = apiCalls().at(-1);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "api", "api"],
      "no message is composed for a candidate with no address",
    );
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_NIEMAND] });
  });

  it("carries on to the next season when one throws", async () => {
    answerWith((call) => {
      if (call.method === "GET") return { acknowledged: 1, saison_ids: ["2526", "2627"] };
      if (saisonOf(call) === "2526") throw new Error("the backend refused this season");
      return {
        acknowledged: 1,
        saison_id: saisonOf(call),
        erinnerungen: [],
        loeschungen: [],
        abgelehnte_geloescht: 0,
        angenommene_geloescht: 0,
        kontaktbloecke_geleert: 0,
        redigierte_aktionen: 0,
      };
    });

    await runBewerbungSweep();

    assert.deepEqual(seasonPasses().map(saisonOf), ["2526", "2627"]);
  });
});
