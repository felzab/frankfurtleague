/**
 * CORE · MongoDB client
 *
 * The one direct database connection the frontend owns. It exists solely for the Auth.js adapter,
 * which targets the separate `authjs` database and has no HTTP transport.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • ONLY `core/auth.ts` may import this. Application data goes through FastAPI without exception —
 *     a second consumer here would be a real violation, not a precedent.
 *   • The development branch caches the client on `global` deliberately: without it, every hot reload
 *     opens a new connection pool and the database runs out of connections within a session.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/overview.md — the authentication section
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
