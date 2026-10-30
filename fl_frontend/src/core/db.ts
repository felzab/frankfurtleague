import "server-only";

import { setTimeout as pause } from "node:timers/promises";

import { MongoClient, ServerApiVersion } from "mongodb";

import { mongodbUri } from "./config";

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // Per operation, never per request: a session read is one aggregate, and a session a passkey made
  // adds that passkey's lookup (`fl_frontend/src/core/auth.ts :: servedSessionOf`). An admin action reads
  // the session in the proxy's slide, its guard and the render after it, so a slow store costs it
  // several times this.

  // Shared inside a transaction, which the adapter runs through `withTransaction`: its operations,
  // commit and retries draw on one budget, so a store slow at each step times the whole out. Its
  // abort after a failed commit has its own.
  timeoutMS: 3000,
  // A visitor's first request after a cold start connects without `timeoutMS`, so an unreachable
  // server is met here. Tighter than `fl_backend/app/core/db.py :: SERVER_SELECTION_TIMEOUT_MS`,
  // which only the backend's boot waits on, where no visitor does.
  serverSelectionTimeoutMS: 3000,
  // The handshake of the reconnect's explicit `connect()`, which `timeoutMS` does not reach and the
  // driver would wait 30 s for. Its monitor times its checks out on this too, so a store whose
  // handshake takes longer reads as down.
  connectTimeoutMS: 3000,
};

let client: MongoClient | undefined;

/**
 * The one client this process opens, built on the first call rather than at import: `next build` and
 * the unit tier import this module holding no URI, and the driver connects on first use either way.
 */
export function signInStore(): MongoClient {
  if (client !== undefined) return client;

  // The development branch caches the client on `global`, or hot reloads exhaust the pool.
  if (process.env.NODE_ENV === "development") {
    const globalWithMongo = global as typeof globalThis & { _mongoClient?: MongoClient };
    globalWithMongo._mongoClient ??= new MongoClient(mongodbUri(), options);
    client = globalWithMongo._mongoClient;
  } else {
    client = new MongoClient(mongodbUri(), options);
  }
  return client;
}

/**
 * Opens the store's client at the boot, its documented use (the driver's `MongoClient.connect`: "generally useful at
 * application boot-time"), and again at the driver's own least interval between two checks of one server until it
 * opens. The driver closes the topology a failed connect built and builds no other on its own, so without this a store
 * down at the boot would fail every operation until a restart; once open, the driver reconnects by itself. Never
 * rejects: each failed attempt goes unlogged, every session read meanwhile logging the same failure.
 */
export async function connectSignInStore(): Promise<void> {
  const store = signInStore();
  for (;;) {
    try {
      await store.connect();
      return;
    } catch {
      // Unreferenced: a store that never answers must not hold open a process that would otherwise exit.
      await pause(store.options.minHeartbeatFrequencyMS, undefined, { ref: false });
    }
  }
}
