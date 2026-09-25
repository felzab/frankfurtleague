import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer, connect as dial } from "node:net";
import { after, describe, it } from "node:test";
import { setTimeout as pause } from "node:timers/promises";

import { MongoDBContainer } from "@testcontainers/mongodb";
import {
  MongoNetworkTimeoutError,
  MongoNotConnectedError,
  MongoOperationTimeoutError,
  MongoServerSelectionError,
  MongoTransactionError,
} from "mongodb";

import { ADMIN_EMAIL, configDouble, cookieHeader, lastMailedToken, ORIGIN, registerAuthDoubles } from "./authDoubles.ts";

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
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((inbound) => {
    if (this.refusing) {
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

const SENT = "__flDbTierSentMail";
const LOGGED = "__flDbTierLogged";
const sent: { to: string; subject: string; text: string }[] = [];
const logged: Record<string, unknown>[] = [];
const globals = globalThis as unknown as Record<string, unknown>;
globals[SENT] = sent;
globals[LOGGED] = logged;

// The query suffix takes the real module past the load hook's match on a path's end: the client
// under test is the one `fl_frontend/src/core/db.ts` builds, over the relay.
const PRODUCTION_DB = `${import.meta.resolve("./db.ts")}?production`;

registerAuthDoubles({
  core: {
    config: configDouble({ MONGODB_URI: RELAYED_URL }),
    db: `export { client } from ${JSON.stringify(PRODUCTION_DB)};`,
    mail: `export const sendMail = async (message) => { globalThis.${SENT}.push(message); return { id: null }; };`,
    logging: `export const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (event, _error, fields) => globalThis.${LOGGED}.push({ event, ...fields }),
};`,
  },
});

// Imported after the hooks above are registered: a static import resolves before they exist.
const { client } = (await import(PRODUCTION_DB)) as { client: MongoClient };
opened.clients.push(client);
const { auth } = await import("./auth.ts");
// The same module evaluated again, so further clients built by the same code, each connecting first
// inside its own case.
const { client: coldClient } = (await import(`${import.meta.resolve("./db.ts")}?cold-start`)) as { client: MongoClient };
opened.clients.push(coldClient);
// Built by the development branch, which caches its client on `global`: the cold start above holds the
// production branch's. Next declares `NODE_ENV` read-only, which is true of a build and not of this process.
const env = process.env as Record<string, string | undefined>;
const nodeEnv = env.NODE_ENV;
env.NODE_ENV = "development";
const { client: recoveringClient } = (await import(`${import.meta.resolve("./db.ts")}?development`).finally(() => {
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
})) as { client: MongoClient };
opened.clients.push(recoveringClient);
const { client: handshakeClient } = (await import(`${import.meta.resolve("./db.ts")}?handshake`)) as { client: MongoClient };
opened.clients.push(handshakeClient);
const { client: closingClient } = (await import(`${import.meta.resolve("./db.ts")}?closing`)) as { client: MongoClient };
opened.clients.push(closingClient);

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
  /* The read every admin request makes twice, in `fl_frontend/src/proxy.ts` and in each guard. The
     library answers a failed read as no session and logs it, so the line is what names the bound. */
  it("ends a session read the store never answers within its `timeoutMS`", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const verified = await auth.api.magicLinkVerify({
      query: { token: lastMailedToken(sent, ADMIN_EMAIL) ?? assert.fail(`nothing was mailed to ${ADMIN_EMAIL}`) },
      headers: new Headers(ORIGIN),
      returnHeaders: true,
    });
    const headers = new Headers({ ...ORIGIN, cookie: cookieHeader(verified) });

    // The control: the same read answers through the relay while it passes requests on.
    const answered = await auth.api.getSession({ headers });
    assert.equal(answered?.user.email, ADMIN_EMAIL);
    logged.length = 0;

    const outcome = await relay.hang(() => settledWithin(OPERATION_BOUND, "the hung read", () => auth.api.getSession({ headers })));

    assert.deepEqual(
      { outcome, logged },
      { outcome: null, logged: [{ event: "auth.library_failed", error_code: "FE-AUTH-003", name: MongoOperationTimeoutError.name }] },
    );
  });

  /* A magic link's sign-in runs the adapter's own transaction to consume its token. The timeout does
     not surface: the adapter aborts whatever failed, the driver refuses an abort after a commit, and
     that refusal replaces it, unlogged. */
  it("ends the adapter's own transaction within its `timeoutMS` when the store never answers its commit", async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(sent, ADMIN_EMAIL) ?? assert.fail(`nothing was mailed to ${ADMIN_EMAIL}`);
    logged.length = 0;

    const outcome = await relay.hangFrom("commitTransaction", () =>
      settledWithin(OPERATION_BOUND, "the hung commit", () =>
        auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true }),
      ),
    );

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
    const child = spawn(
      process.execPath,
      [
        // `server-only` resolved to its own empty build, as a server bundle resolves it.
        "--conditions=react-server",
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        "--import",
        import.meta.resolve("../../tsconfig-alias-hook.mjs"),
        "--input-type=module",
        "--eval",
        `const { client } = await import(${JSON.stringify(import.meta.resolve("./db.ts"))});
await client.db("store_bound").collection("probe").findOne({}).catch(() => undefined);
process.stdout.write("${CHILD_SETTLED}");`,
      ],
      { env: { ...process.env, MONGODB_URI: RELAYED_URL }, stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    const settled = new Promise<void>((resolve) => child.stdout.on("data", (chunk) => String(chunk).includes(CHILD_SETTLED) && resolve()));

    try {
      await relay.refuse(async () => {
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
    } finally {
      child.kill();
    }
  });
});
