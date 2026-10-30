import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect as dial } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as pause } from "node:timers/promises";

import { ADMIN_EMAIL, configDouble, cookieHeader, ORIGIN, overriding, registerAuthDoubles, signInByCode } from "@/test-support/authDoubles.ts";
import { replicaSetUrl, startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { isAPIError } from "better-auth/api";
import {
  MongoNetworkTimeoutError,
  MongoOperationTimeoutError,
  MongoServerSelectionError,
  MongoClient as StoreProbe,
} from "mongodb";
import { assert, describe, expect, it, vi } from "vitest";

import type { MongoClient } from "mongodb";
import type { Socket } from "node:net";

const { mongod, closing } = await startJudgedReplicaSet();

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
  /** The command whose first request `dropOne` loses, every other passed on. */
  private dropping: Buffer | null = null;
  /** Whether `dropOne`'s command was ever sent, without which its case proves nothing. */
  dropped = false;
  /** The command whose first request `dropReplyOf` passes on and whose answer it loses. */
  private silencing: Buffer | null = null;
  /** Whether `dropReplyOf`'s command reached the server, without which its case proves nothing. */
  silenced = false;
  /** Connections `refuse` has closed: none, and the client it was to refuse dialed somewhere else. */
  refused = 0;
  private readonly sockets = new Set<Socket>();
  /**
   * Connections holding a request the relay will never answer, ended with their scenario: the
   * monitor's awaitable hello waits 13 s on one, and its timeout interrupts whatever then runs, a
   * later case's commit included.
   */
  private readonly stranded = new Set<Socket>();
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
    // Set once this connection carried the request whose answer is to be lost: nothing comes back on it.
    let mute = false;
    inbound.on("data", (chunk: Buffer) => {
      if (this.silencing !== null && chunk.includes(this.silencing)) {
        this.silencing = null;
        this.silenced = true;
        mute = true;
        this.stranded.add(inbound);
      }
      if (this.dropping !== null && chunk.includes(this.dropping)) {
        this.dropping = null;
        this.dropped = true;
        this.stranded.add(inbound);
        return;
      }
      if (this.trigger !== null && chunk.includes(this.trigger)) {
        this.hung = true;
        this.triggered = true;
      }
      // Requests are dropped and never answers, so no connection is left holding a reply to a request
      // its client has already given up on.
      if (!this.hung && answered) outbound.write(chunk);
      else this.stranded.add(inbound);
    });
    outbound.on("data", (chunk) => {
      if (!mute) inbound.write(chunk);
    });
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

  /** Runs `body` losing the first request carrying `command` alone: a store answering all else. */
  async dropOne<T>(command: string, body: () => Promise<T>): Promise<T> {
    this.dropped = false;
    this.dropping = Buffer.from(`${command}\0`);
    try {
      return await body();
    } finally {
      this.dropping = null;
      this.endStranded();
    }
  }

  /** Runs `body` passing the first request carrying `command` on and losing its answer alone: a reply lost on its way back. */
  async dropReplyOf<T>(command: string, body: () => Promise<T>): Promise<T> {
    this.silenced = false;
    this.silencing = Buffer.from(`${command}\0`);
    try {
      return await body();
    } finally {
      this.silencing = null;
      this.endStranded();
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
      this.endStranded();
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
    this.endStranded();
  }

  /** Closes every connection a scenario left waiting on an answer, its outbound half with it. */
  private endStranded(): void {
    for (const socket of this.stranded) socket.destroy();
    this.stranded.clear();
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

const relay = new Relay();
closing(() => relay.close());
const RELAYED_URL = `mongodb://127.0.0.1:${await relay.listen()}/?directConnection=true`;

const logged: Record<string, unknown>[] = [];

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db.ts";

registerAuthDoubles({
  core: {
    config: configDouble({}, { mongodbUri: () => RELAYED_URL }),
    db: overriding(PRODUCTION_DB, {}),
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

/** The client a fresh evaluation of `db.ts` builds, the URL's suffix naming the evaluation, and that evaluation's boot connect. */
async function evaluated(url: string): Promise<{ client: MongoClient; connect: () => Promise<void> }> {
  const { signInStore, connectSignInStore } = (await import(url)) as {
    signInStore: () => MongoClient;
    connectSignInStore: () => Promise<void>;
  };
  const client = signInStore();
  closing(() => client.close());
  return { client, connect: connectSignInStore };
}

const storeOf = async (url: string): Promise<MongoClient> => (await evaluated(url)).client;

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const client = await storeOf(PRODUCTION_DB);
const { auth, readServedSession, removePasskey } = await import("./auth.ts");
// The same module evaluated again, so further clients built by the same code, each connecting first
// inside its own case.
const coldClient = await storeOf(`${import.meta.resolve("./db.ts")}?cold-start`);
// Built by the development branch, which caches its client on `global`: the cold start above holds the
// production branch's. Set around the first call, where the branch is taken, and never the import.
const env = process.env as Record<string, string | undefined>;
const nodeEnv = env.NODE_ENV;
// Next declares `NODE_ENV` read-only, which is true of a build and not of this process.
env.NODE_ENV = "development";
const { client: recoveringClient, connect: connectRecovering } = await evaluated(`${import.meta.resolve("./db.ts")}?development`).finally(
  () => {
    if (nodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = nodeEnv;
  },
);
const handshakeClient = await storeOf(`${import.meta.resolve("./db.ts")}?handshake`);

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
        deadline = setTimeout(() => reject(new Error(`${what} had not settled ${bound + LATENESS_MS} ms in`)), bound + LATENESS_MS);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

describe("the sign-in store's client bounds a cold start", () => {
  /* Only a client that has never connected takes the driver's automatic connect, which `timeoutMS`
     does not reach. */
  it("ends the first read against a server that never answers within its `serverSelectionTimeoutMS`", async () => {
    // Held to every operation's bound rather than read off the option: a removed option reads as the
    // driver's thirty-second default, and the case would follow it there.
    const outcome = await relay.hang(() =>
      settledWithin(OPERATION_BOUND, "the cold read", () => coldClient.db("store_bound").collection("probe").findOne({})),
    );

    assert.ok(outcome instanceof MongoServerSelectionError, `the cold read settled with ${String(outcome)}`);
  });

  /* The boot's own call: an explicit `connect()` checks a connection out, which `timeoutMS` does
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

describe("the sign-in store's client bounds every operation it sends", () => {
  /* The read every admin request makes twice, in `fl_frontend/src/proxy.ts` and in each guard. A failed
     read throws rather than reading as no session, and the line names the bound. */
  it("ends a session read the store never answers within its `timeoutMS`", async () => {
    const headers = new Headers({ ...ORIGIN, cookie: cookieHeader(await signInByCode(auth, ADMIN_EMAIL)) });

    // The control: the same read answers through the relay while it passes requests on.
    const answered = await readServedSession(headers);
    expect(answered?.user.email).toBe(ADMIN_EMAIL);
    logged.length = 0;

    const outcome = await relay.hang(() => settledWithin(OPERATION_BOUND, "the hung read", () => readServedSession(headers)));

    assert.ok(isAPIError(outcome) && outcome.status === "INTERNAL_SERVER_ERROR", `the hung read settled with ${String(outcome)}`);
    expect(logged).toStrictEqual([{ event: "auth.library_failed", name: MongoOperationTimeoutError.name }]);
  });

  /* A code's sign-in runs the adapter's own transaction to consume its row, and the commit's own
     timeout is what surfaces: the driver's refusal of an abort after a commit says nothing of whether
     the write may stand. */
  it("ends the adapter's own transaction within two `timeoutMS` when the store never answers its commit", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    logged.length = 0;

    // Two bounds: the abort the adapter sends after a failed commit takes one of its own
    // (`@better-auth/mongo-adapter :: abortTransactionCommand`).
    const outcome = await relay.hangFrom("commitTransaction", () =>
      settledWithin(OPERATION_BOUND * 2, "the hung commit", () =>
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }),
      ),
    );
    // The commit never reached the server, whose transaction would otherwise hold the sign-in's
    // collections until its own lifetime ran out, a minute any later case writing them would wait.
    // Inside the container: the client's strict Stable API refuses the command.
    const killed = await mongod.exec(["mongosh", "--quiet", "--eval", "db.adminCommand({ killAllSessions: [] }).ok"]);
    expect(killed.output.trim(), `the hung commit's transaction was left standing: ${killed.output}`).toBe("1");

    assert.ok(relay.triggered, "the sign-in sent no commit, so nothing here was hung");
    assert.ok(outcome instanceof MongoOperationTimeoutError, `the hung commit settled with ${String(outcome)}`);
    // The abort the hang swallowed too: the one line saying the server may hold the transaction, the
    // commit's own failure being its caller's to log.
    expect(logged).toStrictEqual([{ event: "auth.transaction_left_open", name: MongoOperationTimeoutError.name }]);
  });

  /* A passkey removal runs from a server action, outside every endpoint, where the library writes this
     line to the console, where it stays the library's own output. */
  it("writes a removal's transaction left open to the console when its commit and its abort both hang", async ({ onTestFinished }) => {
    const printed: unknown[][] = [];
    const printing = vi.spyOn(console, "error").mockImplementation((...line: unknown[]) => void printed.push(line));
    onTestFinished(() => void printing.mockRestore());
    await signInByCode(auth, ADMIN_EMAIL);
    const { adapter } = await auth.$context;
    const account = await adapter.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: ADMIN_EMAIL }] });
    assert.ok(account !== null, "the sign-in wrote no account, so no removal runs");
    const held = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "passkey",
      data: {
        userId: account.id,
        credentialID: `fl-db-bound-${randomUUID()}`,
        publicKey: "fabricated-public-key",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "internal",
        createdAt: new Date(),
      },
    });
    logged.length = 0;

    const outcome = await relay.hangFrom("commitTransaction", () =>
      settledWithin(OPERATION_BOUND * 2, "the hung removal", () => removePasskey({ id: account.id, verwaltung: false }, held.id)),
    );
    // As the case above: the transaction the hung commit left would hold the store's rows for a minute.
    const killed = await mongod.exec(["mongosh", "--quiet", "--eval", "db.adminCommand({ killAllSessions: [] }).ok"]);
    expect(killed.output.trim(), `the hung removal's transaction was left standing: ${killed.output}`).toBe("1");

    assert.ok(relay.triggered, "the removal sent no commit, so nothing here was hung");
    assert.ok(outcome instanceof MongoOperationTimeoutError, `the hung removal settled with ${String(outcome)}`);
    expect({ logged: logged, printed: printed.map(([line]) => String(line).includes("Failed to abort a MongoDB transaction")) }).toStrictEqual({
      logged: [],
      printed: [true],
    });
  });

  /* One request lost on its way to a store that answers everything else: the case above's whole hang
     leaves no abort a way through, and this one does. */
  it("leaves the server no transaction open when the adapter's commit is lost on its way", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    logged.length = 0;

    const outcome = await relay.dropOne("commitTransaction", () =>
      settledWithin(OPERATION_BOUND * 2, "the lost commit", () =>
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }),
      ),
    );

    assert.ok(relay.dropped, "the sign-in sent no commit, so nothing here was lost");
    assert.ok(outcome instanceof MongoOperationTimeoutError, `the lost commit settled with ${String(outcome)}`);
    expect(await transactionsHeld()).toStrictEqual([]);
    // The control for the case above's line: an abort that lands says nothing.
    expect(logged).toStrictEqual([]);
    // Aborted rather than committed: the code the transaction would have spent still signs in.
    expect(await codeStillSignsIn(otp)).toBe(true);
  });

  /* The commit lands and its answer does not: the abort after it finds the transaction committed,
     which leaves nothing open and so says nothing, while the caller still hears the commit's own
     timeout, the outcome being unknown to it. */
  it("says nothing of a commit that landed when only its answer is lost", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    logged.length = 0;

    const outcome = await relay.dropReplyOf("commitTransaction", () =>
      settledWithin(OPERATION_BOUND * 2, "the unanswered commit", () =>
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }),
      ),
    );

    assert.ok(relay.silenced, "the sign-in sent no commit, so no answer was lost");
    assert.ok(outcome instanceof MongoOperationTimeoutError, `the unanswered commit settled with ${String(outcome)}`);
    expect(await transactionsHeld()).toStrictEqual([]);
    expect(logged).toStrictEqual([]);
    // Committed: the code is spent, which is what makes the abort's answer TransactionCommitted.
    expect(await codeStillSignsIn(otp)).toBe(false);
  });
});

/** Whether a code signs in once the relay passes everything again: a spent one is refused. */
async function codeStillSignsIn(otp: string): Promise<boolean> {
  return auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN), returnHeaders: true }).then(
    () => true,
    () => false,
  );
}

/**
 * Every operation the server lists that holds a transaction, idle sessions included. Through a client of
 * its own: the store's strict Stable API refuses `$currentOp`.
 */
async function transactionsHeld(): Promise<unknown[]> {
  // IPv4: the mapped port answers there, and `localhost` tried as IPv6 first stalls every connect.
  const probe = new StoreProbe(replicaSetUrl(mongod), { family: 4 });
  try {
    return await probe
      .db("admin")
      .aggregate([
        { $currentOp: { allUsers: true, idleSessions: true } },
        { $match: { transaction: { $exists: true } } },
        { $project: { type: 1, "transaction.parameters": 1 } },
      ])
      .toArray();
  } finally {
    await probe.close();
  }
}

describe("the boot's connect recovers from a cold start the store refused", () => {
  const probe = () => recoveringClient.db("store_bound").collection("probe").findOne({});

  /* The driver closes the topology a refused connect built and builds no other on its own, so only the boot's retry
     opens the client again. */
  it("opens the client once the store answers, its first attempt having been refused", async () => {
    // Wrapped, so the refusal ends with the attempt failed rather than waiting on the connect it started.
    const { connecting } = await relay.refuse(async () => {
      const attemptFailed = once(recoveringClient, "topologyClosed");
      const connected = connectRecovering();
      await settledWithin(OPERATION_BOUND, "the refused attempt", () => attemptFailed);
      return { connecting: connected };
    });

    // The attempt under way when the store answered, then the pause before the next.
    await settledWithin(OPERATION_BOUND + recoveringClient.options.minHeartbeatFrequencyMS, "the boot's connect", () => connecting);
    expect(await settledWithin(OPERATION_BOUND, "the read after the store answered again", probe)).toBe(null);
  });

  /* Its own process, so nothing of this file's holds the event loop open: once the read has failed,
     the boot connect's pause is all that is left. */
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
        `const { connectSignInStore, signInStore } = await import("@/core/db.ts");
void connectSignInStore();
await signInStore().db("store_bound").collection("probe").findOne({}).catch(() => undefined);
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
        expect(first, "the child exited before its read settled").toBe(CHILD_SETTLED);
        const [code] = (await settledWithin(
          recoveringClient.options.minHeartbeatFrequencyMS,
          "the child's exit once its read had failed",
          () => exited,
        )) as [number | null];
        expect(code).toBe(0);
      });
      assert.ok(childRelay.refused > 0, "the child's read was refused by no store here, so its exit proves nothing");
    } finally {
      child.kill();
      await childRelay.close();
      rmSync(secrets, { recursive: true, force: true });
    }
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

      expect(await indexed(), "the index was not built again once the store answered").toBe(true);
      expect(opens, "the client emitted `open`, so this drove a new topology rather than a recovered one").toBe(0);
    } finally {
      client.off("open", counted);
      logged.length = 0;
    }
  });
});
