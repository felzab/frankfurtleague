import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { COPY } from "./core/copy.ts";

/** Everything the scheduler started, in order: each job by its name, then the drain. */
const ran: string[] = [];

/** Each job's own answer, which a case replaces; every job resolves at once otherwise. */
const answers = new Map<string, () => Promise<number | void>>();

const lines: { level: string; event: string; fields: unknown }[] = [];

/** The monitor's address the boot reads, absent where a case sets none, as on every stack but production. */
let heartbeat: string | undefined;
const HEARTBEAT = "https://uptime.example.invalid/api/v1/heartbeat/token";

/** What the drain gave up, which a case sets. */
let aufgegeben = 0;

/** Each ping, as the monitor received it. */
const pings: { url: string; method: string; body: string | undefined }[] = [];
let monitor: () => Promise<Response> = () => Promise.resolve(new Response(null, { status: 200 }));

const job = (name: string) => () => {
  ran.push(name);
  return (answers.get(name) ?? (() => Promise.resolve()))();
};

vi.doMock("@/core/config.ts", () => ({
  // Each boot runs in-process with no preflight naming a deployment.
  bootCheck: () => undefined,
  refuseInvalidEnvironment: (): never => {
    throw new Error("the doubled config refuses no environment");
  },
  frontend_config: { APP_ENV: "production" },
  heartbeatUrl: () => heartbeat,
}));
vi.doMock("@/core/logging.ts", () => ({
  logger: {
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: (event: string, fields?: unknown) => void lines.push({ level: "warn", event, fields }),
    error: (event: string, _message: unknown, fields?: unknown) => void lines.push({ level: "error", event, fields }),
  },
}));
// A production boot builds the sign-in store's indexes too, over a client this suite never configures.
vi.doMock("@/core/authIndexes.ts", () => ({ buildAuthIndexes: () => Promise.resolve() }));
vi.doMock("@/features/bewerbungen/sweep.ts", () => ({ runBewerbungSweep: job("bewerbungen") }));
vi.doMock("@/features/funktionen/sweep.ts", () => ({ runKontoSweep: job("konto") }));
vi.doMock("@/features/saisons/sweep.ts", () => ({ runLoeschungSweep: job("loeschung") }));
vi.doMock("@/features/spielbestaetigungen/sweep.ts", () => ({ runSpielSweep: job("spielbestaetigungen") }));
vi.doMock("@/features/berechtigungen/abgleich.ts", () => ({ runBerechtigungenAbgleich: job("berechtigungen") }));
vi.doMock("@/core/mail.ts", () => ({
  drainPostausgang: async () => {
    ran.push("postausgang");
    return { aufgegeben: aufgegeben };
  },
}));

const { register } = await import("./instrumentation.ts");

const SEKUNDE_MS = 1000;
const MINUTE_MS = 60 * SEKUNDE_MS;
const HOUR_MS = 60 * MINUTE_MS;

const EVERY_JOB = ["bewerbungen", "konto", "loeschung", "spielbestaetigungen", "berechtigungen", "postausgang"];

/** Lets every pending promise settle: a tick starts the pass, which finishes on the microtask queue. */
const settle = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// Next declares `NODE_ENV` read-only, which is true of the value a build inlines and not of this process's own
// environment: the arm under test is exactly the one only a test can move.
const env = process.env as Record<string, string | undefined>;
const nodeEnvBefore = env.NODE_ENV;

beforeEach(() => {
  ran.length = 0;
  lines.length = 0;
  answers.clear();
  heartbeat = undefined;
  aufgegeben = 0;
  pings.length = 0;
  monitor = () => Promise.resolve(new Response(null, { status: 200 }));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    pings.push({ url: String(url), method: init?.method ?? "GET", body: init?.body === undefined ? undefined : String(init.body) });
    return monitor();
  });
  vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  if (nodeEnvBefore === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnvBefore;
});

/** One boot under `nodeEnv`, then each step, answering what had started by the end of each. */
async function bootAndStep(nodeEnv: string, steps: readonly number[]): Promise<string[][]> {
  env.NODE_ENV = nodeEnv;
  const seen: string[][] = [];
  await register();
  for (const step of steps) {
    vi.advanceTimersByTime(step);
    await settle();
    seen.push([...ran]);
  }

  return seen;
}

it("words every server parse in the German map once the server starts, below a message a schema names itself", async () => {
  // Zod's own English, so the case proves the start's install and never a map another suite left on `globalThis`.
  z.config({ customError: undefined });
  expect(z.string().max(2).safeParse("abc").error?.issues[0]?.message).not.toBe(COPY.shared.feld.hoechstensZeichen(2));

  await bootAndStep("test", []);

  expect(z.string().max(2).safeParse("abc").error?.issues[0]?.message).toBe(COPY.shared.feld.hoechstensZeichen(2));
  expect(z.string().max(2, { error: "Höchstens 2 in der Reihe" }).safeParse("abc").error?.issues[0]?.message).toBe("Höchstens 2 in der Reihe");
});

describe("the one scheduler", () => {
  /* Nothing at the boot, where the backend may not answer yet after a deploy; the first pass a minute in, so a
     container recreated daily still runs one; then hourly. Every job each pass, the drain last, sending what they owed. */
  it("runs every job and then the drain a minute after a production boot, and again each hour", async () => {
    const seen = await bootAndStep("production", [0, MINUTE_MS, HOUR_MS - MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS]);

    expect(seen).toStrictEqual([[], EVERY_JOB, EVERY_JOB, [...EVERY_JOB, ...EVERY_JOB]]);
  });

  /* `next dev` reaches whatever backend and transport the developer's own environment names: the league's real people. */
  it("arms nothing under a development build", async () => {
    expect(await bootAndStep("development", [3 * HOUR_MS])).toStrictEqual([[]]);
  });

  /* A job that threw is a job that stopped, and the ones behind it still owe what they owe. */
  it("runs every job behind one that threw, and names it on a line", async () => {
    answers.set("konto", () => Promise.reject(new TypeError("the store went away")));

    const [seen] = await bootAndStep("production", [MINUTE_MS]);

    expect(seen).toStrictEqual(EVERY_JOB);
    expect(lines.filter(({ level }) => level === "error")).toStrictEqual([
      { level: "error", event: "scheduler.job_failed", fields: { job: "konto", name: "TypeError" } },
    ]);
  });

  /* A pass slower than the hour would otherwise run beside itself over the same rows. */
  it("skips an hour that finds the pass still running, with one line", async () => {
    let release = () => {};
    answers.set("bewerbungen", () => new Promise<void>((resolve) => (release = resolve)));

    const [, second] = await bootAndStep("production", [MINUTE_MS, HOUR_MS]);
    release();
    await settle();

    expect(second, "the second hour started a pass beside the first").toStrictEqual(["bewerbungen"]);
    expect(lines.map(({ event }) => event)).toStrictEqual(["scheduler.pass_skipped"]);
    expect(ran).toStrictEqual(EVERY_JOB);
  });
});

describe("the heartbeat after each pass", () => {
  /* The monitor alerts on a pass that did not ping and on one that pinged `/fail`, so what a pass left is the line an
     owner reads first: a job that threw, the deletions a job left, the mails the drain gave up. */
  it("pings the monitor after a pass that did all it owed, and `/fail` naming each job that did not", async () => {
    heartbeat = HEARTBEAT;
    await bootAndStep("production", [MINUTE_MS]);

    answers.set("konto", () => Promise.reject(new TypeError("the store went away")));
    answers.set("loeschung", () => Promise.resolve(3));
    aufgegeben = 2;
    vi.advanceTimersByTime(HOUR_MS);
    await settle();

    expect(pings).toStrictEqual([
      { url: HEARTBEAT, method: "GET", body: undefined },
      { url: `${HEARTBEAT}/fail`, method: "POST", body: "konto failed\nloeschung left 3\npostausgang gave up 2" },
    ]);
  });

  /* The ping is the report, never part of the pass: a monitor that does not answer stops no later pass. */
  it("writes a line where the monitor did not answer, and runs the next pass all the same", async () => {
    heartbeat = HEARTBEAT;
    monitor = () => Promise.reject(new TypeError("fetch failed"));

    await bootAndStep("production", [MINUTE_MS, HOUR_MS]);

    expect(ran).toStrictEqual([...EVERY_JOB, ...EVERY_JOB]);
    expect(lines.map(({ event, fields }) => [event, fields])).toStrictEqual([
      ["scheduler.heartbeat_failed", { name: "TypeError" }],
      ["scheduler.heartbeat_failed", { name: "TypeError" }],
    ]);
  });

  it("pings nothing where the boot holds no address, as every stack but production", async () => {
    await bootAndStep("production", [MINUTE_MS]);

    expect(ran).toStrictEqual(EVERY_JOB);
    expect(pings).toStrictEqual([]);
  });
});
