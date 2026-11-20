import { once } from "node:events";

import { isAPIError } from "better-auth/api";
import { MongoError } from "mongodb";
import { assert, describe, expect, it } from "vitest";

import { ADMIN_EMAIL, configDouble, cookieHeader, ORIGIN, overriding, registerAuthDoubles, signInByCode } from "@/test-support/authDoubles";
import { settledWithin, startReplicaSet } from "@/test-support/replicaSet";
import { signInIndexesForTheFile } from "@/test-support/signInIndexes";
import { captureLog } from "@/test-support/stdoutCapture";
import { StoreRelay } from "@/test-support/storeRelay";

import type { MongoClient } from "mongodb";

const { mongod, closing } = await startReplicaSet();

const relay = new StoreRelay(mongod);
closing(() => relay.close());
const RELAYED_URL = `mongodb://127.0.0.1:${await relay.listen()}/?directConnection=true`;

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

/** Each error line written, its event beside its fields. */
const errorLines = (): Record<string, unknown>[] =>
  log.lines().flatMap(({ level, message, fields }) => (level === "ERROR" ? [{ event: message, ...fields }] : []));

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db";

/** The client a library instance is built on while a case sets it, in place of the file's shared one. */
let handedStore: MongoClient | undefined;

registerAuthDoubles({
  core: {
    config: configDouble({}, { mongodbUri: () => RELAYED_URL }),
    db: overriding(PRODUCTION_DB, { signInStore: (real) => () => handedStore ?? (real.signInStore as () => MongoClient)() }),
  },
});

type Db = { signInStore: () => MongoClient; connectSignInStore: () => Promise<void> };

/** A client `db.ts` builds, the evaluation `url` names. */
async function storeOf(url: string): Promise<{ client: MongoClient; connectSignInStore: () => Promise<void> }> {
  const { signInStore, connectSignInStore } = (await import(url)) as Db;
  const client = signInStore();
  closing(() => client.close());
  return { client, connectSignInStore };
}

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { client } = await storeOf(PRODUCTION_DB);
const { auth } = await import("./auth/library");
const { readServedSession } = await import("./auth/session");
const authIndexes = await import("./authIndexes");
const { MONGO_DB_NAME, buildAuthIndexes } = authIndexes;
// The same module evaluated again, so the boot's connect starts on a client no other case has opened.
const boot = await storeOf(`${import.meta.resolve("./db.ts")}?boot`);
// Both evaluated again for the one case whose bound depends on how many connections its pool holds.
const own = await storeOf(`${import.meta.resolve("./db.ts")}?own`);
const ownLibrary = (await import(`${import.meta.resolve("./auth/library.ts")}?own`)) as { auth: typeof auth };

signInIndexesForTheFile(authIndexes, mongod);

// What a timer firing late on a loaded machine adds to the bound.
const LATENESS_MS = 2000;

// The most a visitor waits on one stage, which `fl_frontend/src/core/db.ts` gives every stage alike. Never
// read off the client: a removed option reads as the driver's 30 s or as none, and so would the bound.
const STAGE_BOUND = 3000;

/**
 * What `run` settled with, its failure included, or the case fails at its bound rather than waiting on: an operation
 * whose bound is gone never ends on its own, because the server's heartbeats still pass the relay and the driver's
 * monitor finds nothing wrong.
 */
const endedWithin = (bound: number, what: string, run: () => Promise<unknown>): Promise<unknown> =>
  settledWithin(
    run().catch((error: unknown) => error),
    bound + LATENESS_MS,
    `${what} had not settled ${String(bound + LATENESS_MS)} ms in`,
  );

/**
 * Resolves once a checkout has begun on `client`'s pool and every one begun is back or has failed: the adapter's index
 * builds start unawaited when its instance is built, and a close would cut one still on the wire.
 */
async function poolSettled(client: MongoClient, withinMs: number): Promise<void> {
  let begun = 0;
  let open = 0;
  const started = () => {
    begun += 1;
    open += 1;
  };
  const ended = () => {
    open -= 1;
  };
  client.on("connectionCheckOutStarted", started);
  client.on("connectionCheckOutFailed", ended);
  client.on("connectionCheckedIn", ended);
  try {
    await expect.poll(() => begun > 0 && open === 0, { timeout: withinMs, interval: 50, message: "the pool never settled" }).toBe(true);
  } finally {
    client.off("connectionCheckOutStarted", started);
    client.off("connectionCheckOutFailed", ended);
    client.off("connectionCheckedIn", ended);
  }
}

describe("the boot's connect recovers from a cold start the store refused", () => {
  /* The driver closes the topology a refused connect built and builds no other on its own, so only the boot's retry
     opens the client again. */
  it("opens the client once the store answers, its first attempt having been refused", async () => {
    // Wrapped, so the refusal ends with the attempt failed rather than waiting on the connect it started.
    const { connecting } = await relay.refuse(async () => {
      const attemptFailed = once(boot.client, "topologyClosed");
      const connected = boot.connectSignInStore();
      await endedWithin(STAGE_BOUND, "the refused attempt", () => attemptFailed);
      return { connecting: connected };
    });

    // The attempt under way when the store answered, then the pause before the next.
    await endedWithin(STAGE_BOUND + boot.client.options.minHeartbeatFrequencyMS, "the boot's connect", () => connecting);
    const probe = () => boot.client.db("store_bound").collection("probe").findOne({});
    expect(await endedWithin(STAGE_BOUND, "the read after the store answered again", probe)).toBe(null);
  });
});

describe("the sign-in store's client bounds every operation it sends", () => {
  /* The read every admin request makes twice, in `fl_frontend/src/proxy.ts` and in each guard. The
     socket's bound ends it, and the read the driver retries then ends at its checkout. A failed read
     throws rather than reading as no session. */
  it("ends a session read the store never answers within its socket's bound and its retry's", async () => {
    const headers = new Headers({ ...ORIGIN, cookie: cookieHeader(await signInByCode(auth, ADMIN_EMAIL)) });

    // The control: the same read answers through the relay while it passes requests on.
    const answered = await readServedSession(headers);
    expect(answered?.user.email).toBe(ADMIN_EMAIL);

    const outcome = await relay.hang(() => endedWithin(STAGE_BOUND * 2, "the hung read", () => readServedSession(headers)));

    assert.ok(isAPIError(outcome) && outcome.status === "INTERNAL_SERVER_ERROR", `the hung read settled with ${String(outcome)}`);
  });

  /* A code's sign-in runs the adapter's own transaction to consume its row. Three stages, on a pool
     holding the one connection the sign-in opened: the commit's socket, the checkout of the commit
     the driver sends again, and the checkout of the adapter's abort after it
     (`@better-auth/mongo-adapter :: abortTransactionCommand`). Each idle connection a pool holds
     turns a checkout into a socket's wait and adds a stage, and the adapter's index builds at its
     start leave several in a shared one, so the case builds a library instance on a client of its
     own and opens that client again once those builds are done. */
  it("ends the adapter's own transaction within three stages' bounds when the store never answers its commit", async ({ task }) => {
    // Within the case's own time limit: each build waits out the opening of a connection through the relay.
    const settled = poolSettled(own.client, task.timeout);
    handedStore = own.client;
    // Read through the instance's lazy build, which takes the store client once, here.
    const context = ownLibrary.auth.$context;
    handedStore = undefined;
    await context;
    await settled;
    await own.client.close();
    await own.client.connect();
    const { auth: ownAuth } = ownLibrary;

    const otp = await ownAuth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    log.clear();

    const outcome = await relay.hangFrom("commitTransaction", () =>
      endedWithin(STAGE_BOUND * 3, "the hung commit", () =>
        ownAuth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }),
      ),
    );
    // The commit never reached the server, whose transaction would otherwise hold the sign-in's
    // collections until its own lifetime ran out, a minute any later case writing them would wait.
    // Inside the container: the client's strict Stable API refuses the command.
    const killed = await mongod.exec(["mongosh", "--quiet", "--eval", "db.adminCommand({ killAllSessions: [] }).ok"]);
    expect(killed.output.trim(), `the hung commit's transaction was left standing: ${killed.output}`).toBe("1");

    assert.ok(relay.triggered, "the sign-in sent no commit, so nothing here was hung");
    assert.ok(outcome instanceof MongoError, `the hung commit settled with ${String(outcome)}`);
    // The abort the hang swallowed too: the one line saying the server may hold the transaction, the
    // commit's own failure being its caller's to log. Which stage's bound ended the abort is the
    // driver's race between two equal timers, so the line's error name is left unread.
    expect(errorLines().map(({ event }) => event)).toStrictEqual(["auth.transaction_left_open"]);
  });
});

describe("the sign-in store's indexes recover with the store", () => {
  /* The client opened before the outage, so its topology is the one recovering, and the driver marks
     that recovery with no `open`: only a new topology emits one. */
  it("builds an index again once a store that stopped answering after the first open answers again", async ({ task }) => {
    const sessions = client.db(MONGO_DB_NAME).collection("session");
    await sessions.dropIndex("session_userId_idx");
    let opens = 0;
    const counted = () => {
      opens += 1;
    };
    client.on("open", counted);

    try {
      log.clear();
      // A severed store fails each index of a collection on its own server selection, under its own bound.
      await relay.sever(() => buildAuthIndexes());
      assert.ok(
        errorLines().some((line) => line.event === "auth.index_unbuilt" && line.index === "session_userId_idx"),
        `the run met no outage: ${JSON.stringify(errorLines())}`,
      );
      const indexed = async () => (await sessions.indexes()).some(({ name }) => name === "session_userId_idx");

      // Production asks again on every writable heartbeat until a build succeeds, so the case waits for the index, within
      // its own time limit, rather than for a count of attempts.
      await expect
        .poll(indexed, { timeout: task.timeout, interval: 200, message: "the index was not built again once the store answered" })
        .toBe(true);
      // The rebuild's other indexes may still be on the wire: a run queues behind the one in flight, so the file's
      // close meets no build to cut.
      await buildAuthIndexes();
      expect(opens, "the client emitted `open`, so this drove a new topology rather than a recovered one").toBe(0);
    } finally {
      client.off("open", counted);
      log.clear();
    }
  });
});
