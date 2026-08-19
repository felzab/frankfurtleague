/**
 * CORE · MongoDB client
 *
 * The one direct database connection the frontend owns — solely for the Auth.js adapter, which
 * targets the separate `authjs` database and has no HTTP transport.
 *
 * Invariants:
 * - Only `core/auth.ts` may import this; application data goes through FastAPI.
 * - The development branch caches the client on `global`, or hot reloads exhaust the pool.
 *
 * See:
 * - docs/frontend/overview.md — the authentication section
 */

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
  const globalWithMongo = global as typeof globalThis & {
    _mongoClient?: MongoClient;
  };

  if (!globalWithMongo._mongoClient) {
    globalWithMongo._mongoClient = new MongoClient(frontend_config.MONGODB_URI, options);
  }
  client = globalWithMongo._mongoClient;
} else {
  client = new MongoClient(frontend_config.MONGODB_URI, options);
}

export { client };
