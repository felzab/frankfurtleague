import "server-only";

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

let client: MongoClient;

// The development branch caches the client on `global`, or hot reloads exhaust the pool.
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
