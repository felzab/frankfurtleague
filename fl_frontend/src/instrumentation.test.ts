import { memoryAdapterDouble, memoryStore, overriding, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { networkFailure, refusal, serveBackend, serveHost } from "@/test-support/backend.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FLOutboxHandout } from "@/core/generated/client/types.ts";

/* Every pass here runs the five real jobs and the real drain, the backend and the hosts they reach answered on the
   network: what a job did is what the backend saw it ask. */

/** A request as a line of what a pass sent: its method and its path. */
type Call = `${"GET" | "POST"} /${string}`;

/** What one request is answered with, handed the request. */
type Answer = (request: { search: URLSearchParams; body: unknown }) => unknown;

/** One call of the pupils' deletion, `after` the place the next call starts after. */
const erasure = (spieler: number, { failed = 0, remaining = 0, after = null as string | null } = {}) => ({
  completed_saison_id: spieler === 0 ? null : "2526",
  spieler,
  saison_spieler: spieler,
  registrierungen: 0,
  skipped: 0,
  failed,
  remaining,
  after,
});

/** A Postausgang holding nothing to hand out. */
const NOTHING_HANDED_OUT = { lease: null, mails: [], abandoned: 0 };

/** One owed mail as the backend hands it out, which the drain sends. */
const OWED_MAIL: FLOutboxHandout = {
  id: "6890a1b2c3d4e5f607510001",
  to: "person@schule.de",
  data: { kind: "deletion_notice", saison_id: null },
  secret: null,
  token: null,
  attempt: 1,
};

/** A hand-out holding `OWED_MAIL`, under a lease the report names. */
const HANDING_OUT_ONE = { lease: "a-lease", mails: [OWED_MAIL], abandoned: 0 };

/** The backend's hand-outs in turn, each drain's claim taking the next; past the last, nothing to hand out. */
let handouts: unknown[] = [];

/** What every job meets on an idle day: nothing to act on, each answered as the contract shapes it. */
const IDLE: Readonly<Record<Call, Answer>> = {
  "GET /bewerbungen/sweep": () => ({ saison_ids: [] }),
  "POST /address_change/sweep": () => ({ removed: 0, effective: 0, discarded: 0, remaining: 0, after: null }),
  "GET /address_change/sweep/moves": () => ({ moves: [] }),
  "POST /schiedsrichter/sweep": () => ({ erased: 0, failed: 0 }),
  // The one account the store holds, which a record references.
  "POST /identity/references": () => ({ unreferenced: [] }),
  "POST /identity/erasure/sweep": () => erasure(0),
  "GET /spielbestaetigungen/sweep": () => ({ saison_ids: [] }),
  "POST /grants/handover": () => ({ handed_over: 0 }),
  "POST /outbox/handout": () => handouts.shift() ?? NOTHING_HANDED_OUT,
  "POST /outbox/result": () => ({ sent: 1, repeated: 0, abandoned: 0, held: 0, ignored: 0 }),
};

/** Each request's answer, by its method and path; a case replaces the ones it means, and a request none names fails it. */
let answers = new Map<string, Answer>();

const backend = serveBackend(({ method, path, search, body }) => answers.get(`${method} ${path}`)?.({ search, body }));

/** The monitor's address the boot reads, absent where a case sets none, as on every stack but production. */
let heartbeat: string | undefined;
const MONITOR = "https://uptime.example.invalid";
const HEARTBEAT = `${MONITOR}/api/v1/heartbeat/token`;

/** How the monitor answers a ping, which a case replaces. */
let monitor: () => unknown = () => new Response(null, { status: 200 });

/** Each ping, as the monitor received it. */
const pinged = serveHost(MONITOR, () => monitor());

// The provider's send, the drain's one way out: a deployment that mails, which no other stack is.
serveHost("https://api.resend.com", ({ method, url }) => (method === "POST" && url.pathname === "/emails" ? { id: "a-message" } : undefined));

/** The hold on the background jobs, and the deployment, which the boot reads: off and the mailing one unless a case says otherwise. */
const settings: Record<string, unknown> = {};

/** Each boot's connect of the sign-in store, which never opens: the boot must not wait on it. */
let storeConnects = 0;

const STORE = "__flSchedulerStore";
const store = memoryStore(STORE);

registerAuthDoubles({
  core: {
    // The environment's edge: the values a case varies, every other reader the real one over the run's secret files.
    config: overriding("@/core/config.ts", {
      frontend_config: ({ frontend_config }) => Object.assign(settings, frontend_config, { APP_VERSION: "sha-1234567", APP_ENV: "production" }),
      heartbeatUrl: () => () => heartbeat,
      authResendKey: () => () => "fabricated-resend-not-a-credential",
    }),
    // The store client, the driver's edge: a production boot connects it, and the library reads its store through it.
    db: {
      signInStore: () => ({ db: () => ({}) }),
      connectSignInStore: () => {
        storeConnects += 1;
        return new Promise<void>(() => undefined);
      },
    },
    // A production boot builds the sign-in store's indexes too, over a client this suite never configures.
    authIndexes: overriding("@/core/authIndexes.ts", { buildAuthIndexes: () => () => Promise.resolve() }),
  },
  specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});
const log = captureLog();

const { register } = await import("./instrumentation.ts");
const { auth } = await import("@/core/auth/library.ts");
const { drainOutbox } = await import("@/core/mail.ts");

const schedulerLines = () =>
  log
    .lines()
    .filter(({ message }) => message.startsWith("scheduler."))
    .map(({ level, message, fields }) => ({ level, message, fields }));

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/** Every request one idle pass sends: each job's in the order they run, then the drain's claim. */
const EVERY_JOB: readonly Call[] = [
  "GET /bewerbungen/sweep",
  "POST /address_change/sweep",
  "GET /address_change/sweep/moves",
  "POST /schiedsrichter/sweep",
  "POST /identity/references",
  "POST /identity/erasure/sweep",
  "GET /spielbestaetigungen/sweep",
  "POST /grants/handover",
  "POST /outbox/handout",
];

/** Every request the backend saw since the case began. */
const sentNow = (): string[] => backend.sent.map(({ method, path }) => `${method} ${path}`);

/** What each job counts on an idle day, as the pass line names it. */
const IDLE_COUNTS = {
  bewerbungen: {
    bewerbung_failed: 0,
    registrierung_failed: 0,
    address_change_removed: 0,
    address_change_effective: 0,
    address_change_discarded: 0,
    address_change_remaining: 0,
    schiedsrichter_erased: 0,
    schiedsrichter_failed: 0,
  },
  account: { unreferenced: 0, deleted: 0, already_deleted: 0, failed: 0 },
  erasure: { completed_saison_id: null, spieler: 0, saison_spieler: 0, registrierungen: 0, skipped: 0, failed: 0, remaining: 0 },
  spielbestaetigungen: { closed: 0, asked: 0, reminded: 0, mails: 0, failed: 0 },
  grants: { handed_over: 0 },
};

/** What the drains counted, as the pass line names it. */
const drained = (counts: Partial<Record<"sent" | "abandoned", number>> = {}) => ({
  sent: 0,
  repeated: 0,
  abandoned: 0,
  held: 0,
  ignored: 0,
  ...counts,
});

beforeEach(async () => {
  answers = new Map(Object.entries(IDLE));
  handouts = [];
  heartbeat = undefined;
  settings["RESTORE_HOLD"] = "off";
  monitor = () => new Response(null, { status: 200 });
  for (const rows of Object.values(store)) rows.length = 0;
  // One account, so the account job has a store to judge and a read to send.
  const { adapter } = await auth.$context;
  await adapter.create({
    model: "user",
    data: { email: "konto@schule.de", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() },
  });
  vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
});

afterEach(() => void vi.useRealTimers());

/** One production boot, then each step, answering what the backend had been sent by the end of each. */
async function bootAndStep(steps: readonly number[]): Promise<string[][]> {
  const seen: string[][] = [];
  await register();
  for (const step of steps) {
    vi.advanceTimersByTime(step);
    // Every request a tick set off, to the backend and to every host, answered: the pass runs on the network alone.
    await backend.answered();
    seen.push(sentNow());
  }

  return seen;
}

/* Every case here boots a production build, whose `NODE_ENV` the `unit-production` project sets: under any other value
   the boot arms nothing, and each case would read a scheduler that never started. */
it("runs under a production build's NODE_ENV", () => {
  expect(process.env.NODE_ENV).toBe("production");
});

/* The driver builds no topology of its own after a failed first connect, so a store down at the boot would refuse every
   sign-in until a restart: the boot starts the connect that retries, and serves without waiting on it. */
it("starts the sign-in store's connect at a production boot without waiting on it", async () => {
  storeConnects = 0;
  await bootAndStep([]);

  expect(storeConnects).toBe(1);
});

describe("the one scheduler", () => {
  /* Nothing at the boot, where the backend may not answer yet after a deploy; the first pass a minute in, so a
     container recreated daily still runs one; then hourly. Every job each pass, the drain last, sending what they owed. */
  it("runs every job and then the drain a minute after a production boot, and again each hour", async () => {
    const seen = await bootAndStep([0, MINUTE_MS, HOUR_MS - MINUTE_MS - SECOND_MS, SECOND_MS]);

    expect(seen).toStrictEqual([[], EVERY_JOB, EVERY_JOB, [...EVERY_JOB, ...EVERY_JOB]]);
  });

  /* A restore's steps are done on the admin pages against the restored state, which a pass would act on first: the
     pupils' deletion, mail to people not yet erased again. */
  it("arms nothing under the hold, and says so", async () => {
    settings["RESTORE_HOLD"] = "on";

    expect(await bootAndStep([MINUTE_MS, 3 * HOUR_MS])).toStrictEqual([[], []]);
    expect(backend.served, "a job reached the sign-in helpers' answers").toStrictEqual([]);
    expect(schedulerLines().map(({ message }) => message)).toStrictEqual(["scheduler.held"]);
  });

  /* A job that threw is a job that stopped, and the ones behind it still owe what they owe. The applications' job, the
     first, throws where its address half's call is refused. */
  it("runs every job behind one that threw, and names it on a line", async () => {
    answers.set("POST /address_change/sweep", () => refusal(undefined, { status: 503 }));

    const [seen] = await bootAndStep([MINUTE_MS]);

    expect(seen).toStrictEqual(EVERY_JOB.filter((call) => call !== "GET /address_change/sweep/moves" && call !== "POST /schiedsrichter/sweep"));
    // The job's name and the error's alone, and no error on the line: a failure on any job's path can carry an address.
    expect(
      log
        .lines()
        .filter(({ level }) => level === "ERROR")
        .map(({ message, fields, raw }) => ({ message, fields, error: (JSON.parse(raw) as { error?: unknown }).error })),
    ).toStrictEqual([
      { message: "scheduler.job_failed", fields: { job: "bewerbungen", name: "APIBadStatusError", status: 503 }, error: undefined },
    ]);
  });

  /* A pass slower than the hour would otherwise run beside itself over the same rows. */
  it("skips an hour that finds the pass still running, with one line", async () => {
    let release = () => {};
    let arrived = () => {};
    const held = new Promise<void>((resolve) => (arrived = resolve));
    answers.set("GET /bewerbungen/sweep", async () => {
      arrived();
      await new Promise<void>((resolve) => (release = resolve));
      return { saison_ids: [] };
    });
    await register();
    vi.advanceTimersByTime(MINUTE_MS);
    await held;

    vi.advanceTimersByTime(HOUR_MS);
    const second = sentNow();
    release();
    await backend.answered();

    expect(second, "the second hour started a pass beside the first").toStrictEqual(["GET /bewerbungen/sweep"]);
    expect(schedulerLines().map(({ message }) => message)).toStrictEqual(["scheduler.pass_skipped"]);
    expect(sentNow()).toStrictEqual(EVERY_JOB);
  });
});

describe("the pass's one line", () => {
  /* One line per pass where anything happened, every job's counts and every drain's in it, the drains a write started
     among them; a warning where the pass left anything owed, so a level above INFO still shows it. */
  it("writes one line counting every job and every drain since the last pass, a warning where one did not finish", async () => {
    answers.set("GET /spielbestaetigungen/sweep", () => ({ saison_ids: ["2627"] }));
    answers.set("POST /spielbestaetigungen/sweep/2627", () => ({ saison_id: "2627", closed: 1, asked: 2, reminded: 0, mails: 2, failed: 0 }));
    await register();
    // A write's drain inside the hour, as `afterResponse.ts :: drainSoon` runs it behind a response: one mail sent.
    handouts = [HANDING_OUT_ONE, NOTHING_HANDED_OUT, HANDING_OUT_ONE];
    await drainOutbox();
    // The pass's own drain sends the second.
    vi.advanceTimersByTime(MINUTE_MS);
    await backend.answered();

    answers = new Map(Object.entries(IDLE));
    answers.set("POST /identity/erasure/sweep", ({ search }) =>
      search.has("after") ? refusal(undefined, { status: 503 }) : erasure(4, { remaining: 3, after: `${"e".repeat(23)}5` }),
    );
    vi.advanceTimersByTime(HOUR_MS);
    await backend.answered();

    expect(schedulerLines()).toStrictEqual([
      {
        level: "INFO",
        message: "scheduler.pass",
        fields: {
          ...IDLE_COUNTS,
          spielbestaetigungen: { closed: 1, asked: 2, reminded: 0, mails: 2, failed: 0 },
          outbox: drained({ sent: 2 }),
        },
      },
      { level: "ERROR", message: "scheduler.job_failed", fields: { job: "erasure", name: "APIBadStatusError", status: 503 } },
      {
        level: "WARNING",
        message: "scheduler.pass",
        fields: {
          ...IDLE_COUNTS,
          erasure: { completed_saison_id: "2526", spieler: 4, saison_spieler: 4, registrierungen: 0, skipped: 0, failed: 0 },
          outbox: drained(),
          failures: ["erasure failed"],
        },
      },
    ]);
  });
});

describe("the heartbeat after each pass", () => {
  /* The monitor alerts on a pass that did not ping and on one that pinged `/fail`, so what a pass left is the line an
     owner reads first: a job that threw, the deletions a job left, the mails the drain gave up. */
  it("pings the monitor after a pass that did all it owed, and `/fail` naming each job that did not", async () => {
    heartbeat = HEARTBEAT;
    await bootAndStep([MINUTE_MS]);

    answers.set("POST /address_change/sweep", () => refusal(undefined, { status: 503 }));
    answers.set("POST /identity/erasure/sweep", () => erasure(4, { failed: 3, remaining: 3 }));
    // Given up by a write's drain inside the hour, never the pass's own: the pass reports every drain's.
    handouts = [{ ...NOTHING_HANDED_OUT, abandoned: 2 }];
    await drainOutbox();
    vi.advanceTimersByTime(HOUR_MS);
    await backend.answered();

    expect(pinged.map(({ method, url, body }) => ({ url: url.href, method, body }))).toStrictEqual([
      { url: HEARTBEAT, method: "GET", body: undefined },
      { url: `${HEARTBEAT}/fail`, method: "POST", body: "bewerbungen failed\nerasure left 3\noutbox gave up 2" },
    ]);
  });

  /* The ping is the report, never part of the pass: a monitor that does not answer stops no later pass. */
  it("writes a line where the monitor did not answer, and runs the next pass all the same", async () => {
    heartbeat = HEARTBEAT;
    monitor = networkFailure;

    await bootAndStep([MINUTE_MS, HOUR_MS]);

    expect(sentNow()).toStrictEqual([...EVERY_JOB, ...EVERY_JOB]);
    expect(schedulerLines().map(({ message, fields }) => [message, fields])).toStrictEqual([
      ["scheduler.heartbeat_failed", { name: "TypeError" }],
      ["scheduler.heartbeat_failed", { name: "TypeError" }],
    ]);
  });
});
