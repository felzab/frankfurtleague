/**
 * CORE · MongoDB client
 *
 * The one direct database connection the frontend owns — solely for the Auth.js adapter, which
 * targets the separate `authjs` database and has no HTTP transport.
 *
 * Invariants:
 * - Only `core/auth.ts` may import this (ADR-0010); application data goes through FastAPI.
 * - The development branch caches the client on `global`, or hot reloads exhaust the pool.
 *
 * See:
 * - docs/frontend/overview.md — the authentication section
 */

// This approach is taken from https://github.com/vercel/next.js/tree/canary/examples/with-mongodb
import "server-only";

import { MongoClient, ServerApiVersion } from "mongodb";

import { frontend_config } from "./config";

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
};

let client: MongoClient;

if (process.env.NODE_ENV === "development") {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  const globalWithMongo = global as typeof globalThis & {
    _mongoClient?: MongoClient;
  };

  if (!globalWithMongo._mongoClient) {
    globalWithMongo._mongoClient = new MongoClient(frontend_config.MONGODB_URI, options);
  }
  client = globalWithMongo._mongoClient;
} else {
  client = new MongoClient(frontend_config.MONGODB_URI, options); // production mode
}

export { client };
