import "server-only";

import { MongoError, MongoServerError } from "mongodb";

import { signInStore } from "./db";
import { logger } from "./logging";

import type { CreateIndexesOptions, IndexSpecification, TopologyDescriptionChangedEvent } from "mongodb";

// Named for what the database holds rather than for the library that writes it, so the next swap
// inherits a name it does not have to migrate.
export const MONGO_DB_NAME = "auth";

/** One index of the sign-in store, as `createIndex` takes it. */
type AuthIndex = {
  readonly collection: "session" | "passkey" | "user" | "verification";
  readonly key: IndexSpecification;
  readonly options: CreateIndexesOptions & { readonly name: string };
};

/**
 * One index per query the library and this application send, derived from the flows
 * `fl_frontend/src/core/authIndexes.db.test.ts` drives with table scans refused (`docs/frontend/spec.md :: I499`).
 * The library declares none of them at table level, so its adapter builds none.
 */
const AUTH_INDEXES: readonly AuthIndex[] = [
  // The cookie's own value, read by every guard.
  { collection: "session", key: { token: 1 }, options: { name: "session_token_uidx", unique: true } },
  { collection: "session", key: { userId: 1 }, options: { name: "session_userId_idx" } },
  // Each of these three names is the one production's hand-made index carries, read in its Atlas
  // console on 2026-09-27 and moving there without us: a same-key index under another name refuses
  // the build with code 85.
  { collection: "session", key: { expiresAt: 1 }, options: { name: "expiresAt_1", expireAfterSeconds: 0 } },
  { collection: "passkey", key: { credentialID: 1 }, options: { name: "credentialID_1", unique: true } },
  { collection: "verification", key: { expiresAt: 1 }, options: { name: "expiresAt_1", expireAfterSeconds: 0 } },
  // Never unique: each administrator holds several passkeys.
  { collection: "passkey", key: { userId: 1 }, options: { name: "passkey_userId_idx" } },
  // Unique, or a ban ending the sessions of one account at an address leaves a second one's standing.
  { collection: "user", key: { email: 1 }, options: { name: "user_email_uidx", unique: true } },
  // Never unique: each bound counts several rows under one identifier.
  { collection: "verification", key: { identifier: 1 }, options: { name: "verification_identifier_idx" } },
];

// A build waits on no visitor, so the client's per-request `timeoutMS` never holds it: cut short, the
// server abandons it unmade. Chosen, not measured, and bounded so an unanswered build lets its connection go.
const INDEX_BUILD_TIMEOUT_MS = 60_000;

/** The run in flight, which the next waits out, for the reason one collection's builds run in order. */
let running: Promise<void> = Promise.resolve();

/** Whether a rebuild already waits on the store's recovery, so one outage arms one. */
let rebuildArmed = false;

/**
 * One collection's builds in order and the collections side by side: MongoDB documents nothing about
 * two builds racing on one collection. Never rejects, so the boot's unawaited call leaves no rejection
 * unhandled (`docs/frontend/spec.md :: I498`).
 */
export function buildAuthIndexes(): Promise<void> {
  running = running.then(buildOnce);
  return running;
}

async function buildOnce(): Promise<void> {
  const database = signInStore().db(MONGO_DB_NAME);
  const lanes = Map.groupBy(AUTH_INDEXES, (index) => index.collection);

  await Promise.all(
    [...lanes].map(async ([collection, indexes]) => {
      for (const { key, options } of indexes) {
        try {
          await database.collection(collection).createIndex(key, { ...options, timeoutMS: INDEX_BUILD_TIMEOUT_MS });
        } catch (failed) {
          logUnbuilt(options.name, failed);
          // No server code is a store that did not answer, which a restart would only meet again.
          if (!(failed instanceof MongoServerError)) rebuildOnRecovery();
        }
      }
    }),
  );
}

/**
 * The client reconnects on its own once the store answers (`docs/frontend/spec.md :: I364`), and the
 * build runs again on the first topology holding a writable server, rather than waiting for the next boot.
 */
function rebuildOnRecovery(): void {
  if (rebuildArmed) return;
  rebuildArmed = true;
  const store = signInStore();
  // Never `open`, which the driver emits for a new topology alone: one recovering after its first open
  // emits none, and the rebuild would wait for the next boot.
  const recovered = ({ newDescription }: TopologyDescriptionChangedEvent): void => {
    if (![...newDescription.servers.values()].some((server) => server.isWritable)) return;
    store.off("topologyDescriptionChanged", recovered);
    rebuildArmed = false;
    void buildAuthIndexes();
  };
  store.on("topologyDescriptionChanged", recovered);
}

/**
 * The index and the server's code, never the message: a duplicate-key refusal quotes the duplicated
 * value, and on `user.email` that is an address.
 */
function logUnbuilt(index: string, failed: unknown): void {
  logger.error("auth.index_unbuilt", undefined, {
    error_code: "FE-AUTH-011",
    index: index,
    name: failed instanceof Error ? failed.name : "unknown",
    code: failed instanceof MongoError ? failed.code : undefined,
    codeName: failed instanceof MongoError ? Reflect.get(failed, "codeName") : undefined,
  });
}
