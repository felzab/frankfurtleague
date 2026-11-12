import "server-only";

import { MongoError, MongoServerError } from "mongodb";

import { signInStore } from "./db";
import { logger } from "./logging";

import type { IndexOptions, IndexSpecification, TopologyDescriptionChangedEvent } from "mongodb";

// Named for what the database holds rather than for the library that writes it, so the next swap
// inherits a name it does not have to migrate.
export const MONGO_DB_NAME = "auth";

/** One index of the sign-in store, as `createIndex` takes it. */
type AuthIndex = {
  readonly collection: "session" | "passkey" | "user" | "verification";
  readonly key: IndexSpecification;
  readonly options: IndexOptions & { readonly name: string };
};

/**
 * One index per query the library and this application send to the sign-in store.
 * The library declares none of them at table level, so its adapter builds none.
 */
const AUTH_INDEXES: readonly AuthIndex[] = [
  // The cookie's own value, read by every guard.
  { collection: "session", key: { token: 1 }, options: { name: "session_token_uidx", unique: true } },
  { collection: "session", key: { userId: 1 }, options: { name: "session_userId_idx" } },
  // Each of these three names is the one production's hand-made index carries, which can change there
  // without us: a same-key index under another name refuses the build with code 85.
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

/** The run in flight, which the next waits out, so no two runs race on one collection. */
let running: Promise<void> = Promise.resolve();

/** Whether a rebuild already waits on the store's recovery, so one outage arms one. */
let rebuildArmed = false;

/**
 * One collection's builds in order and the collections side by side: MongoDB documents nothing about
 * two builds racing on one collection. Never rejects, so the boot's unawaited call leaves no rejection
 * unhandled.
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
          // Under the client's socket bound like every call: a build outlasting it is logged unbuilt
          // and still finishes, since the server keeps a build whose connection closed.
          await database.collection(collection).createIndex(key, options, undefined);
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
 * The client reconnects on its own once the store answers, and the
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
    index,
    name: failed instanceof Error ? failed.name : "unknown",
    code: failed instanceof MongoError ? failed.code : undefined,
    codeName: failed instanceof MongoError ? Reflect.get(failed, "codeName") : undefined,
  });
}
