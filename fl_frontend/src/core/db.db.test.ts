import { setTimeout as pause } from "node:timers/promises";

import { ADMIN_EMAIL, configDouble, cookieHeader, ORIGIN, overriding, registerAuthDoubles, signInByCode } from "@/test-support/authDoubles.ts";
import { startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { StoreRelay } from "@/test-support/storeRelay.ts";
import { isAPIError } from "better-auth/api";
import { MongoError, MongoServerSelectionError } from "mongodb";
import { assert, describe, expect, it } from "vitest";

import type { MongoClient } from "mongodb";

const { mongod, closing } = await startJudgedReplicaSet();

const relay = new StoreRelay(mongod);
closing(() => relay.close());
const RELAYED_URL = `mongodb://127.0.0.1:${await relay.listen()}/?directConnection=true`;
/** The address the next client `db.ts` builds is given. */
let storeUrl = RELAYED_URL;

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

/** Each error line written, its event beside its fields. */
const errorLines = (): Record<string, unknown>[] =>
  log.lines().flatMap(({ level, message, fields }) => (level === "ERROR" ? [{ event: message, ...fields }] : []));

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db.ts";

registerAuthDoubles({
  core: {
    config: configDouble({}, { mongodbUri: () => storeUrl }),
    db: overriding(PRODUCTION_DB, {}),
  },
});

/** The client a fresh evaluation of `db.ts` builds, the URL's suffix naming the evaluation. */
async function storeOf(url: string): Promise<MongoClient> {
  const { signInStore } = (await import(url)) as { signInStore: () => MongoClient };
  const client = signInStore();
  closing(() => client.close());
  return client;
}

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const client = await storeOf(PRODUCTION_DB);
const { auth } = await import("./auth/library.ts");
const { readServedSession } = await import("./auth/session.ts");
// The same module evaluated again, so further clients built by the same code, each connecting first
// inside its own case.
const coldClient = await storeOf(`${import.meta.resolve("./db.ts")}?cold-start`);
// One whose pool keeps no connection idle, as a pool the store's outage emptied: every read opens its own.
storeUrl = `${RELAYED_URL}&maxIdleTimeMS=1`;
const openingClient = await storeOf(`${import.meta.resolve("./db.ts")}?openings`);
storeUrl = RELAYED_URL;

// What a timer firing late on a loaded machine adds to the bound.
const LATENESS_MS = 2000;

// The most a visitor waits on one stage, which `fl_frontend/src/core/db.ts` gives every stage alike. Never
// read off the client: a removed option reads as the driver's 30 s or as none, and so would the bound.
const STAGE_BOUND = 3000;

/**
 * The case fails at its bound rather than waiting on: an operation whose bound is gone never ends on
 * its own, because the server's heartbeats still pass the relay and the driver's monitor finds nothing
 * wrong.
 */
async function settledWithin(bound: number, what: string, run: () => Promise<unknown>): Promise<unknown> {
  let deadline: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      run().catch((error: unknown) => error),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`${what} had not settled ${bound + LATENESS_MS} ms in`)), bound + LATENESS_MS);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

describe("the sign-in store's client bounds a cold start", () => {
  /* Only a client that has never connected takes the driver's automatic connect, which server
     selection alone bounds. */
  it("ends the first read against a server that never answers within its `serverSelectionTimeoutMS`", async () => {
    const outcome = await relay.hang(() =>
      settledWithin(STAGE_BOUND, "the cold read", () => coldClient.db("store_bound").collection("probe").findOne({})),
    );

    assert.ok(outcome instanceof MongoServerSelectionError, `the cold read settled with ${String(outcome)}`);
  });
});

describe("the sign-in store's client bounds a connection's opening", () => {
  /* The pool opens two connections at once at most, and a checkout that gives up on an opening leaves it running: only
     the opening's own bound frees its place, without which every read waits out its checkout once two openings hang. */
  it("serves a read once the store answers again, two openings it never answered having filled the pool's places", async () => {
    await openingClient.connect();
    // Past the pool's idle bound, so the connection the connect checked out is pruned rather than handed to a read.
    await pause(10);
    const read = () => openingClient.db("store_bound").collection("probe").findOne({});

    const { during, after, ignored } = await relay.ignoreOpenings(
      () =>
        settledWithin(STAGE_BOUND, "the reads the store never answered", () =>
          Promise.all([read().catch((error: unknown) => error), read().catch((error: unknown) => error)]),
        ),
      // Two stages: an opening that timed out marks the server unknown, so the read selects it again before it opens one.
      () => settledWithin(STAGE_BOUND * 2, "the read after the store answered again", read),
    );

    expect(ignored, "the reads opened no connection the store left unanswered").toBe(2);
    assert.ok(
      Array.isArray(during) && during.every((outcome) => outcome instanceof MongoError),
      `the unanswered reads settled with ${String(during)}`,
    );
    expect(after).toBe(null);
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

    const outcome = await relay.hang(() => settledWithin(STAGE_BOUND * 2, "the hung read", () => readServedSession(headers)));

    assert.ok(isAPIError(outcome) && outcome.status === "INTERNAL_SERVER_ERROR", `the hung read settled with ${String(outcome)}`);
  });

  /* A code's sign-in runs the adapter's own transaction to consume its row. Three stages: the
     commit's socket, the checkout of the commit the driver sends again, and the checkout of the
     adapter's abort after it (`@better-auth/mongo-adapter :: abortTransactionCommand`). */
  it("ends the adapter's own transaction within three stages' bounds when the store never answers its commit", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    log.clear();

    const outcome = await relay.hangFrom("commitTransaction", () =>
      settledWithin(STAGE_BOUND * 3, "the hung commit", () =>
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }),
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
  it("builds an index again once a store that stopped answering after the first open answers again", async () => {
    const { MONGO_DB_NAME, buildAuthIndexes } = await import("./authIndexes.ts");
    const sessions = client.db(MONGO_DB_NAME).collection("session");
    await buildAuthIndexes();
    await sessions.dropIndex("session_userId_idx");
    let opens = 0;
    const counted = () => {
      opens += 1;
    };
    client.on("open", counted);

    try {
      log.clear();
      await relay.sever(() => buildAuthIndexes());
      assert.ok(
        errorLines().some((line) => line.event === "auth.index_unbuilt" && line.index === "session_userId_idx"),
        `the run met no outage: ${JSON.stringify(errorLines())}`,
      );
      const indexed = async () => (await sessions.indexes()).some(({ name }) => name === "session_userId_idx");

      // The monitor's next check of a store it marked unknown, and the build itself.
      const deadline = Date.now() + client.options.minHeartbeatFrequencyMS + STAGE_BOUND + LATENESS_MS;
      while (!(await indexed()) && Date.now() < deadline) await pause(200);

      expect(await indexed(), "the index was not built again once the store answered").toBe(true);
      expect(opens, "the client emitted `open`, so this drove a new topology rather than a recovered one").toBe(0);
    } finally {
      client.off("open", counted);
      log.clear();
    }
  });
});
