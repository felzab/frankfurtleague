import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it, mock } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** One thing that happened, in the order it happened: the two orderings this slice owes are orderings between the two kinds. */
type SweepEvent =
  | { kind: "api"; endpoint: string; method: string; authType?: string; params?: Record<string, string>; body?: string }
  | { kind: "mail"; to: string; subject: string };

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
  globalThis.__flSweepEvents.push({ kind: "mail", to: mail.to, subject: mail.subject });
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

const seasonPasses = (): ApiEvent[] =>
  apiCalls().filter((call) => call.method === "POST" && !call.endpoint.endsWith("/loeschen") && saisonOf(call) !== "");

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

/** One deletion candidate; a null address is the seat the erasure emptied, which the notice cannot reach. */
const loeschung = (bewerbungId: string, address: string | null) => ({
  bewerbung_id: bewerbungId,
  saison_id: "2627",
  schule: "Goetheschule",
  bestaetigungsfrist: "2026-09-04",
  ansprechperson_email: address,
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
  it("arms nothing where the switch is off", async () => {
    recorders.__flSweepSwitch = "off";
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

    await register();
    await settle();
    mock.timers.tick(HOUR_MS * 3);
    await settle();
    mock.timers.reset();

    assert.deepEqual(events, []);
  });

  it("arms nothing where the value is missing, which is what a skipped validation leaves", async () => {
    recorders.__flSweepSwitch = undefined;
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

    await register();
    await settle();
    mock.timers.tick(HOUR_MS * 3);
    await settle();
    mock.timers.reset();

    assert.deepEqual(events, []);
  });

  it("runs one pass a minute after start and one an hour after arming", async () => {
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });

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
    mock.timers.reset();

    assert.equal(atOnce, 0, "nothing runs at arming: the backend may not answer yet after a deploy");
    assert.equal(afterTheMinute, 1, "the first pass runs a minute in, a container recreated daily never reaching the first tick");
    assert.equal(beforeTheHour, 1, "nothing runs between the first pass and the hour");
    assert.equal(afterTheHour, 2, "the interval is one hour, measured from arming");
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
            seats: [{ rolle: "ansprechperson", vorname: "Erika", token: "token-a" }],
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

  it("mails the deletion notice before the erasure, and erases only where it arrived", async () => {
    refused.add("stumm@schule.de");
    sweepAnswers({
      saisonIds: ["2627"],
      loeschungen: {
        "2627": [loeschung(ID_ERREICHT, "erika@schule.de"), loeschung(ID_STUMM, "stumm@schule.de")],
      },
    });

    await runBewerbungSweep();

    const erasure = apiCalls().at(-1);
    assert.equal(erasure?.endpoint, "/bewerbungen/sweep/2627/loeschen");
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "mail", "mail", "api"],
      "both notices go out before anything is erased",
    );
    assert.deepEqual(JSON.parse(erasure?.body ?? "{}"), { bewerbung_ids: [ID_ERREICHT] });
  });

  it("erases a candidate whose Ansprechperson seat is empty, there being nobody left to tell", async () => {
    sweepAnswers({ saisonIds: ["2627"], loeschungen: { "2627": [loeschung(ID_NIEMAND, null)] } });

    await runBewerbungSweep();

    const erasure = apiCalls().at(-1);
    assert.deepEqual(
      events.map((event) => event.kind),
      ["api", "api", "api"],
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
