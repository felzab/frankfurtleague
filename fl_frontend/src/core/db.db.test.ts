import { once } from "node:events";

import { isAPIError } from "better-auth/api";
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

registerAuthDoubles({
  core: {
    config: configDouble({}, { mongodbUri: () => RELAYED_URL }),
    db: overriding(PRODUCTION_DB, {}),
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
});

describe("the sign-in store's indexes recover with the store", () => {
  /* The client opened before the outage, so its topology is the one recovering, and the driver marks
     that recovery with no `open`: only a new topology emits one. */
  it("builds an index again once a store that stopped answering after the first open answers again", async ({ task }) => {
    const sessions = client.db(MONGO_DB_NAME).collection("session");
    await sessions.dropIndex("expiresAt_1");
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
        errorLines().some((line) => line.event === "auth.index_unbuilt" && line.index === "expiresAt_1"),
        `the run met no outage: ${JSON.stringify(errorLines())}`,
      );
      const indexed = async () => (await sessions.indexes()).some(({ name }) => name === "expiresAt_1");

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
