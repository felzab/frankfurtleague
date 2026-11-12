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
  // One bound per stage, each taken again by every attempt the driver retries: a read the store never
  // answers ends after its own socket bound and its retry's checkout. An admin action reads the
  // session in the proxy's slide, its guard and the render after it, so a slow store costs it
  // several times these.

  // An unreachable store. Tighter than the backend's `SERVER_SELECTION_TIMEOUT_MS`, which only its boot
  // waits on, where no visitor does.
  serverSelectionTimeoutMS: 3000,
  // A checkout from the pool, which waits out the opening of the connection it hands over: a store
  // that accepts and never answers a handshake.
  waitQueueTimeoutMS: 3000,
  // One connection's opening and handshake, which the checkout above stops waiting for but the pool
  // does not: the opening holds one of its two `maxConnecting` slots until this ends. The monitor
  // times its checks out on it too, so a store whose handshake takes longer reads as down.
  connectTimeoutMS: 3000,
  // Each send and receive on an open connection: a read or a commit the store never answers, and
  // the index build.
  socketTimeoutMS: 3000,
  // Nothing bounds a transaction whole. The adapter runs one through the driver's `withTransaction`,
  // which retries a write conflict, and sends again a commit whose answer was lost, for up to 120 s:
  // no per-stage option shortens that, and the `timeoutMS` the adapter's documentation offers for it
  // has no effect in this driver. A store answering all but commits holds a sign-in that long.
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
