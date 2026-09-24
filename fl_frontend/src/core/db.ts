import "server-only";

import { setTimeout as pause } from "node:timers/promises";

import { MongoClient, ServerApiVersion } from "mongodb";

import { frontend_config } from "./config";

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // Per operation, and an admin action runs up to seven: three session reads of two commands
  // (measured against `next start` on 2026-09-24) and a refresh, so a slow store costs it up to 21 s
  // (`docs/frontend/spec.md :: I362`).
  timeoutMS: 3000,
  // A visitor's first request after a cold start connects without `timeoutMS`, so an unreachable
  // server is met here. Tighter than `fl_backend/app/core/config.py :: db_server_selection_timeout`,
  // which only the backend's boot waits on, where no visitor does.
  serverSelectionTimeoutMS: 3000,
};

/**
 * The driver closes the topology a failed connect built and never builds another itself, so every
 * later operation would fail until a restart (`docs/frontend/spec.md :: I364`). The same client is
 * connected again: the adapter holds its `Db`.
 */
class SignInStoreClient extends MongoClient {
  // The driver's `connect()` builds a topology for a client already closed, so the reconnect asks
  // this before each attempt rather than the driver.
  #closed = false;

  constructor(url: string) {
    super(url, options);
    let opened = false;
    let reconnecting = false;
    this.once("open", () => {
      opened = true;
    });
    // Before the first open only a failed connect or a close ends a topology: once open, the driver
    // reconnects on its own.
    this.on("topologyClosed", () => {
      if (opened || reconnecting || this.#closed) return;
      reconnecting = true;
      void (async () => {
        while (!opened && !this.#closed) {
          // The driver's own least interval between two checks of one server, and unreferenced: a retry
          // that never succeeds must not hold open a process that would otherwise exit.
          await pause(this.options.minHeartbeatFrequencyMS, undefined, { ref: false });
          if (this.#closed) return;
          // Unlogged: each session read meanwhile logs the same failure (`FE-AUTH-003`).
          await this.connect().catch(() => undefined);
        }
        // A close landing while an attempt resolves a `mongodb+srv` host finds none of that attempt's
        // topology yet, which then opens.
        if (this.#closed) await super.close();
      })();
    });
  }

  override async close(force?: boolean): Promise<void> {
    this.#closed = true;
    await super.close(force);
  }
}

let client: MongoClient;

// The development branch caches the client on `global`, or hot reloads exhaust the pool.
if (process.env.NODE_ENV === "development") {
  const globalWithMongo = global as typeof globalThis & {
    _mongoClient?: MongoClient;
  };

  if (!globalWithMongo._mongoClient) {
    globalWithMongo._mongoClient = new SignInStoreClient(frontend_config.MONGODB_URI);
  }
  client = globalWithMongo._mongoClient;
} else {
  client = new SignInStoreClient(frontend_config.MONGODB_URI);
}

export { client };
