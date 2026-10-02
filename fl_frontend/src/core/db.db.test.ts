import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect as dial } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as pause } from "node:timers/promises";

import { MongoDBContainer } from "@testcontainers/mongodb";
import { isAPIError } from "better-auth/api";
import {
  MongoNetworkTimeoutError,
  MongoNotConnectedError,
  MongoOperationTimeoutError,
  MongoServerSelectionError,
  MongoTransactionError,
} from "mongodb";

import { ADMIN_EMAIL, configDouble, cookieHeader, ORIGIN, registerAuthDoubles, signInByCode } from "./authDoubles.ts";
import { itLeftNoTransactionToExpire, watchExpiredTransactions } from "./expiredTransactions.ts";
import { overridingModule } from "./exportingModule.ts";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { MongoClient } from "mongodb";
import type { Socket } from "node:net";

/* Each resource set as it opens, and the hook registered before the first await that can throw: a
   container that started is stopped whatever fails after it. */
const opened: { mongod?: StartedMongoDBContainer; relay?: Relay; clients: MongoClient[] } = { clients: [] };

after(async () => {
  for (const client of opened.clients) await client.close();
  await opened.relay?.close();
  await opened.mongod?.stop();
});

const mongod = await new MongoDBContainer("mongo:8.3.11").start();
opened.mongod = mongod;
await watchExpiredTransactions(mongod);

/**
 * A TCP relay to the mongod that can stop passing the client's requests on: a hung connection as the
 * client meets it, every socket open and nothing answering.
 */
class Relay {
  private hung = false;
  private refusing = false;
  /** Connections still to pass while `hangAfterFirst` runs, every later one opened and never answered. */
  private passing: number | null = null;
  /** The command whose first request hangs the relay, as its name opens a BSON key. */
  private trigger: Buffer | null = null;
  /** Whether `hangFrom`'s command was ever sent, without which its case proves nothing. */
  triggered = false;
  /** Connections `refuse` has closed: none, and the client it was to refuse dialed somewhere else. */
  refused = 0;
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((inbound) => {
    if (this.refusing) {
      this.refused += 1;
      inbound.destroy();
      return;
    }
    let answered = true;
    if (this.passing !== null) {
      answered = this.passing > 0;
      this.passing -= 1;
    }
    const outbound = dial(mongod.getMappedPort(27017), mongod.getHost());
    for (const socket of [inbound, outbound]) {
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      socket.on("error", () => undefined);
    }
    inbound.on("data", (chunk: Buffer) => {
      if (this.trigger !== null && chunk.includes(this.trigger)) {
        this.hung = true;
        this.triggered = true;
      }
      // Requests are dropped and never answers, so no connection is left holding a reply to a request
      // its client has already given up on.
      if (!this.hung && answered) outbound.write(chunk);
    });
    outbound.on("data", (chunk) => inbound.write(chunk));
    inbound.on("close", () => outbound.destroy());
    outbound.on("close", () => inbound.destroy());
  });

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const address = this.server.address();
    assert.ok(address !== null && typeof address === "object");
    return address.port;
  }

  /** Runs `body` while nothing the client sends reaches the server, and passes it on again after. */
  async hang<T>(body: () => Promise<T>): Promise<T> {
    this.hung = true;
    try {
      return await body();
    } finally {
      this.resume();
    }
  }

  /** `hang` from the first request carrying `command` on, every request before it answered. */
  async hangFrom<T>(command: string, body: () => Promise<T>): Promise<T> {
    this.triggered = false;
    this.trigger = Buffer.from(`${command}\0`);
    try {
      return await body();
    } finally {
      this.resume();
    }
  }

  /**
   * Runs `body` passing the first connection the client opens and hanging every later one: a store
   * that answers the monitor it meets first and never a handshake after it.
   */
  async hangAfterFirst<T>(body: () => Promise<T>): Promise<T> {
    this.passing = 1;
    try {
      return await body();
    } finally {
      this.passing = null;
    }
  }

  /** Runs `body` while every connection the client opens is closed at once, as a server refusing it. */
  async refuse<T>(body: () => Promise<T>): Promise<T> {
    this.refusing = true;
    try {
      return await body();
    } finally {
      this.refusing = false;
    }
  }

  /**
   * Runs `body` while the store is gone: every socket open through the relay closed and every new one
   * refused. A hang is no outage to the client's monitor, whose streamed heartbeats keep arriving.
   */
  async sever<T>(body: () => Promise<T>): Promise<T> {
    this.refusing = true;
    for (const socket of this.sockets) socket.destroy();
    try {
      return await body();
    } finally {
      this.refusing = false;
    }
  }

  private resume(): void {
    this.hung = false;
    this.trigger = null;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

const relay = new Relay();
opened.relay = relay;
const RELAYED_URL = `mongodb://127.0.0.1:${await relay.listen()}/?directConnection=true`;

const logged: Record<string, unknown>[] = [];

// The query suffix takes the real module past the load hook's match on a path's end: the client
// under test is the one `fl_frontend/src/core/db.ts` builds, over the relay.
const PRODUCTION_DB = `${import.meta.resolve("./db.ts")}?production`;

registerAuthDoubles({
  core: {
    config: configDouble({ MONGODB_URI: RELAYED_URL }),
    db: overridingModule(PRODUCTION_DB, {}),
    logging: {
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (event: string, _error: unknown, fields?: Record<string, unknown>) => void logged.push({ event, ...fields }),
      },
    },
  },
});

/** The client a fresh evaluation of `db.ts` builds, the URL's suffix naming the evaluation. */
async function storeOf(url: string): Promise<MongoClient> {
  const { signInStore } = (await import(url)) as { signInStore: () => MongoClient };
  const client = signInStore();
  opened.clients.push(client);
  return client;
}

// Imported after the hooks above are registered: a static import resolves before they exist.
const client = await storeOf(PRODUCTION_DB);
const { auth, readServedSession } = await import("./auth.ts");
// The same module evaluated again, so further clients built by the same code, each connecting first
// inside its own case.
const coldClient = await storeOf(`${import.meta.resolve("./db.ts")}?cold-start`);
// Built by the development branch, which caches its client on `global`: the cold start above holds the
// production branch's. Set around the first call, where the branch is taken, and never the import.
const env = process.env as Record<string, string | undefined>;
const nodeEnv = env.NODE_ENV;
// Next declares `NODE_ENV` read-only, which is true of a build and not of this process.
env.NODE_ENV = "development";
const recoveringClient = await storeOf(`${import.meta.resolve("./db.ts")}?development`).finally(() => {
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
});
const handshakeClient = await storeOf(`${import.meta.resolve("./db.ts")}?handshake`);
const closingClient = await storeOf(`${import.meta.resolve("./db.ts")}?closing`);

// What a timer firing late on a loaded machine adds to the bound.
const LATENESS_MS = 2000;

/** What a fresh process takes to load `db.ts` and its imports, generously: it only keeps a child that never reads from hanging the case. */
const CHILD_LOAD_MS = 10_000;
const CHILD_SETTLED = "settled";

const OPERATION_BOUND = client.timeoutMS ?? assert.fail("the sign-in store's client sets no `timeoutMS`");

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
        deadline = setTimeout(
          () => reject(new assert.AssertionError({ message: `${what} had not settled ${bound + LATENESS_MS} ms in` })),
          bound + LATENESS_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

describe("the sign-in store's client bounds a cold start (`docs/frontend/spec.md :: I362`)", () => {
  /* Only a client that has never connected takes the driver's automatic connect, which `timeoutMS`
     does not reach. */
  it("ends the first read against a server that never answers within its `serverSelectionTimeoutMS`", async () => {
    const reopened = once(coldClient, "open");
    // Held to every operation's bound rather than read off the option: a removed option reads as the
    // driver's thirty-second default, and the case would follow it there.
    const outcome = await relay.hang(() =>
      settledWithin(OPERATION_BOUND, "the cold read", () => coldClient.db("store_bound").collection("probe").findOne({})),
    );

    assert.ok(outcome instanceof MongoServerSelectionError, `the cold read settled with ${String(outcome)}`);

    // The reconnect after a hung first connect (`docs/frontend/spec.md :: I364`), awaited before the
    // next case hangs the relay under it.
    await settledWithin(OPERATION_BOUND + coldClient.options.minHeartbeatFrequencyMS, "the cold client's reconnect", () => reopened);
  });

  /* The reconnect's own call: an explicit `connect()` checks a connection out, which `timeoutMS` does
     not reach, so only the handshake's bound ends it. */
  it("ends an explicit connect whose handshake the store never answers within its `connectTimeoutMS`", async () => {
    try {
      const outcome = await relay.hangAfterFirst(() => settledWithin(OPERATION_BOUND, "the hung handshake", () => handshakeClient.connect()));
      assert.ok(outcome instanceof MongoNetworkTimeoutError, `the hung handshake settled with ${String(outcome)}`);
    } finally {
      await handshakeClient.close();
    }
  });
});

describe("the sign-in store's client bounds every operation it sends (`docs/frontend/spec.md :: I362`)", () => {
  /* The read every admin request makes twice, in `fl_frontend/src/proxy.ts` and in each guard. A failed
     read throws rather than reading as no session (`docs/frontend/spec.md :: I519`), and the line names the bound. */
  it("ends a session read the store never answers within its `timeoutMS`", async () => {
    const headers = new Headers({ ...ORIGIN, cookie: cookieHeader(await signInByCode(auth, ADMIN_EMAIL)) });

    // The control: the same read answers through the relay while it passes requests on.
    const answered = await readServedSession(headers);
    assert.equal(answered?.user.email, ADMIN_EMAIL);
    logged.length = 0;

    const outcome = await relay.hang(() => settledWithin(OPERATION_BOUND, "the hung read", () => readServedSession(headers)));

    assert.ok(isAPIError(outcome) && outcome.status === "INTERNAL_SERVER_ERROR", `the hung read settled with ${String(outcome)}`);
    assert.deepEqual(logged, [{ event: "auth.library_failed", error_code: "FE-AUTH-003", name: MongoOperationTimeoutError.name }]);
  });

  /* A code's sign-in runs the adapter's own transaction to consume its row. The timeout does not
     surface: the adapter aborts whatever failed, the driver refuses an abort after a commit, and that
     refusal replaces it, unlogged. */
  it("ends the adapter's own transaction within its `timeoutMS` when the store never answers its commit", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    logged.length = 0;

    const outcome = await relay.hangFrom("commitTransaction", () =>
      settledWithin(OPERATION_BOUND, "the hung commit", () =>
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }),
      ),
    );
    // The commit never reached the server, whose transaction would otherwise hold the sign-in's
    // collections until its own lifetime ran out, a minute any later case writing them would wait.
    // Inside the container: the client's strict Stable API refuses the command.
    const killed = await mongod.exec(["mongosh", "--quiet", "--eval", "db.adminCommand({ killAllSessions: [] }).ok"]);
    assert.equal(killed.output.trim(), "1", `the hung commit's transaction was left standing: ${killed.output}`);

    assert.ok(relay.triggered, "the sign-in sent no commit, so nothing here was hung");
    // Pinned to `@better-auth/mongo-adapter`'s masking, an upstream defect: a release that stops
    // aborting after a failed commit turns this red, and the case then asserts the commit's own error.
    assert.ok(
      outcome instanceof MongoTransactionError && outcome.message === "Cannot call abortTransaction after calling commitTransaction",
      `the hung commit settled with ${String(outcome)}`,
    );
    assert.deepEqual(logged, []);
  });
});

describe("the sign-in store's client recovers from a cold start it could not complete (`docs/frontend/spec.md :: I364`)", () => {
  const probe = () => recoveringClient.db("store_bound").collection("probe").findOne({});

  it("answers again once the store does, its first connect having been refused", async () => {
    const reopened = once(recoveringClient, "open");
    const refused = await relay.refuse(() => settledWithin(OPERATION_BOUND, "the refused read", probe));
    assert.ok(refused instanceof MongoServerSelectionError, `the refused read settled with ${String(refused)}`);

    // One attempt already under way, then the pause before the next.
    await settledWithin(OPERATION_BOUND + recoveringClient.options.minHeartbeatFrequencyMS, "the reconnect", () => reopened);
    assert.equal(await settledWithin(OPERATION_BOUND, "the read after the store answered again", probe), null);
  });

  it("stays closed once closed, its first connect having been refused", async () => {
    const read = () => closingClient.db("store_bound").collection("probe").findOne({});
    let reopened = false;
    closingClient.on("open", () => {
      reopened = true;
    });

    const refused = await relay.refuse(async () => {
      const outcome = await settledWithin(OPERATION_BOUND, "the refused read", read);
      await settledWithin(OPERATION_BOUND, "the close", () => closingClient.close());
      return outcome;
    });
    assert.ok(refused instanceof MongoServerSelectionError, `the refused read settled with ${String(refused)}`);

    // The store answers again for as long as one attempt and the pause before it would take to open.
    await pause(OPERATION_BOUND + closingClient.options.minHeartbeatFrequencyMS + LATENESS_MS);
    const closedRead = await settledWithin(OPERATION_BOUND, "the read after the close", read);

    assert.equal(reopened, false, "the client its owner closed opened again once the store answered");
    assert.ok(closedRead instanceof MongoNotConnectedError, `the read after the close settled with ${String(closedRead)}`);
  });

  /* Its own process, so nothing of this file's holds the event loop open: once the read has failed,
     the reconnect's pause is all that is left. */
  it("lets a process whose store refuses it exit once its read has failed", async () => {
    // A relay of the child's own, so what it refuses is the child's alone and never this file's clients'.
    const childRelay = new Relay();
    const childUrl = `mongodb://127.0.0.1:${await childRelay.listen()}/?directConnection=true`;
    // The child's config reads the store's address from its secrets directory and never from the environment.
    const secrets = mkdtempSync(path.join(tmpdir(), "fl-db-child-"));
    writeFileSync(path.join(secrets, "frontend_mongodb_uri"), childUrl);
    const child = spawn(
      process.execPath,
      [
        // `server-only` resolved to its own empty build, as a server bundle resolves it.
        "--conditions=react-server",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import",
        import.meta.resolve("../../scripts/tsconfig-alias-hook.mjs"),
        "--input-type=module",
        "--eval",
        `const client = (await import("@/core/db.ts")).signInStore();
await client.db("store_bound").collection("probe").findOne({}).catch(() => undefined);
process.stdout.write(process.env.FL_CHILD_SETTLED ?? "");`,
      ],
      // The marker travels as data in the environment rather than as source.
      { env: { ...process.env, SECRETS_DIR: secrets, FL_CHILD_SETTLED: CHILD_SETTLED }, stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    const settled = new Promise<void>((resolve) => child.stdout.on("data", (chunk) => String(chunk).includes(CHILD_SETTLED) && resolve()));

    try {
      await childRelay.refuse(async () => {
        const first = await settledWithin(CHILD_LOAD_MS + OPERATION_BOUND, "the child's read", () =>
          Promise.race([settled.then(() => CHILD_SETTLED), exited.then(() => "an exit")]),
        );
        assert.equal(first, CHILD_SETTLED, "the child exited before its read settled");
        const [code] = (await settledWithin(
          recoveringClient.options.minHeartbeatFrequencyMS,
          "the child's exit once its read had failed",
          () => exited,
        )) as [number | null];
        assert.equal(code, 0);
      });
      assert.ok(childRelay.refused > 0, "the child's read was refused by no store here, so its exit proves nothing");
    } finally {
      child.kill();
      await childRelay.close();
      rmSync(secrets, { recursive: true, force: true });
    }
  });
});

describe("the sign-in store's indexes recover with the store (`docs/frontend/spec.md :: I520`)", () => {
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
      logged.length = 0;
      await relay.sever(() => buildAuthIndexes());
      assert.ok(
        logged.some((line) => line.event === "auth.index_unbuilt" && line.index === "session_userId_idx"),
        `the run met no outage: ${JSON.stringify(logged)}`,
      );
      const indexed = async () => (await sessions.indexes()).some(({ name }) => name === "session_userId_idx");

      // The monitor's next check of a store it marked unknown, and the build itself.
      const deadline = Date.now() + client.options.minHeartbeatFrequencyMS + OPERATION_BOUND + LATENESS_MS;
      while (!(await indexed()) && Date.now() < deadline) await pause(200);

      assert.equal(await indexed(), true, "the index was not built again once the store answered");
      assert.equal(opens, 0, "the client emitted `open`, so this drove a new topology rather than a recovered one");
    } finally {
      client.off("open", counted);
      logged.length = 0;
    }
  });
});

// Last, so every case above has run against the count it reads.
itLeftNoTransactionToExpire(mongod);
