import "server-only";

import { MongoClient, ServerApiVersion } from "mongodb";

import { frontend_config } from "./config";

const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // An admin request makes five store operations at most: two session reads of two each, and one
  // refresh. At 3 s each, the store's share stays inside one backend call's
  // `fl_frontend/src/core/api.ts :: BASE_FETCH_TIMEOUT_MS` (`docs/frontend/spec.md :: I362`).
  timeoutMS: 3000,
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
