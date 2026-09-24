import assert from "node:assert/strict";
import { createServer, connect as dial } from "node:net";
import { after, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoOperationTimeoutError, MongoServerSelectionError, MongoTransactionError } from "mongodb";

import { ADMIN_EMAIL, configDouble, cookieHeader, lastMailedToken, ORIGIN, registerAuthDoubles } from "./authDoubles.ts";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { MongoClient } from "mongodb";
import type { Socket } from "node:net";

/* Each resource set as it opens, and the hook registered before the first await that can throw: a
   container that started is stopped whatever fails after it. */
const opened: { mongod?: StartedMongoDBContainer; relay?: Relay; clients: MongoClient[] } = { clients: [] };

after(async () => {
  opened.relay?.resume();
  for (const client of opened.clients) await client.close();
  await opened.relay?.close();
  await opened.mongod?.stop();
});

const mongod = await new MongoDBContainer("mongo:8").start();
opened.mongod = mongod;

/**
 * A TCP relay to the mongod that can stop passing the client's requests on: a hung connection as the
 * client meets it, every socket open and nothing answering.
 */
class Relay {
  private hung = false;
  /** The command whose first request hangs the relay, as its name opens a BSON key. */
  private trigger: Buffer | null = null;
  /** Whether `hangFrom`'s command was ever sent, without which its case proves nothing. */
  triggered = false;
  private readonly sockets = new Set<Socket>();
  private readonly server = createServer((inbound) => {
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
      if (!this.hung) outbound.write(chunk);
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

  /** Also called before the client closes: a case timed out inside `hang` never reaches its `finally`. */
  resume(): void {
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
// The same module evaluated a second time, so a second client built by the same code: an automatic
// connect that fails closes its client's topology for good, and every later operation on it fails.
const { client: coldClient } = (await import(`${import.meta.resolve("./db.ts")}?cold-start`)) as { client: MongoClient };
opened.clients.push(coldClient);

// What a timer firing late on a loaded machine adds to the bound.
const LATENESS_MS = 2000;

// Ends a case whose bound is gone, where a hung read never ends: the server's own heartbeats still
// pass the relay, so the driver's monitor finds nothing wrong and nothing else gives up on it.
const CASE_TIMEOUT = { timeout: 30_000 };

/** How long `run` took to settle, and what it settled with. */
async function timed(run: () => Promise<unknown>): Promise<{ elapsed: number; outcome: unknown }> {
  const started = performance.now();
  const outcome = await run().catch((error: unknown) => error);
  return { elapsed: performance.now() - started, outcome };
}

describe("the sign-in store's client bounds a cold start (`docs/frontend/spec.md :: I362`)", () => {
  /* Only a client that has never connected takes the driver's automatic connect, which `timeoutMS`
     does not reach. */
  it("ends the first read against a server that never answers within its `serverSelectionTimeoutMS`", CASE_TIMEOUT, async () => {
    const { elapsed, outcome } = await relay.hang(() => timed(() => coldClient.db("store_bound").collection("probe").findOne({})));

    assert.ok(outcome instanceof MongoServerSelectionError, `the cold read settled with ${String(outcome)}`);
    assert.ok(elapsed < coldClient.options.serverSelectionTimeoutMS + LATENESS_MS, `the cold read took ${Math.round(elapsed)} ms`);
  });
});

describe("the sign-in store's client bounds every operation it sends (`docs/frontend/spec.md :: I362`)", () => {
  /* The read every admin request makes twice, in `fl_frontend/src/proxy.ts` and in each guard. The
     library answers a failed read as no session and logs it, so the line is what names the bound. */
  it("ends a session read the store never answers within its `timeoutMS`", CASE_TIMEOUT, async () => {
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

    const { elapsed, outcome } = await relay.hang(() => timed(() => auth.api.getSession({ headers })));

    assert.deepEqual(
      { outcome, logged },
      { outcome: null, logged: [{ event: "auth.library_failed", error_code: "FE-AUTH-003", name: MongoOperationTimeoutError.name }] },
    );
    assert.ok(elapsed < (client.timeoutMS ?? 0) + LATENESS_MS, `the hung read took ${Math.round(elapsed)} ms`);
  });

  /* A magic link's sign-in runs the adapter's own transaction to consume its token. The timeout does
     not surface: the adapter aborts whatever failed, the driver refuses an abort after a commit, and
     that refusal replaces it, unlogged. */
  it("ends the adapter's own transaction within its `timeoutMS` when the store never answers its commit", CASE_TIMEOUT, async () => {
    await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
    const token = lastMailedToken(sent, ADMIN_EMAIL) ?? assert.fail(`nothing was mailed to ${ADMIN_EMAIL}`);
    logged.length = 0;

    const { elapsed, outcome } = await relay.hangFrom("commitTransaction", () =>
      timed(() => auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true })),
    );

    assert.ok(relay.triggered, "the sign-in sent no commit, so nothing here was hung");
    assert.ok(
      outcome instanceof MongoTransactionError && outcome.message === "Cannot call abortTransaction after calling commitTransaction",
      `the hung commit settled with ${String(outcome)}`,
    );
    assert.deepEqual(logged, []);
    assert.ok(elapsed < (client.timeoutMS ?? 0) + LATENESS_MS, `the hung commit took ${Math.round(elapsed)} ms`);
  });
});
