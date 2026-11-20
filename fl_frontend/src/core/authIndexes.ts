import "server-only";

import { MongoError, MongoServerError } from "mongodb";

import { signInStore } from "./db";
import { logger } from "./logging";

import type { IndexOptions, IndexSpecification, ServerHeartbeatSucceededEvent } from "mongodb";

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
 * The sign-in store's indexes the library's adapter leaves to this application. The adapter builds one for each field
 * its schema marks, the plain ones on the session's and the passkey's `userId` and the code row's `identifier` among
 * them, and it reports a build failed at its start on the console, outside the envelope. It builds no expiry and no
 * unique credential. A unique index is the one guard against two writes racing for a key, so each stands here, the two
 * the adapter builds under the same name and options included: this build logs a failure as an event of its own and,
 * after an outage, asks again once the store answers. The adapter's plain index on the passkey's `credentialID`,
 * beside the unique one here, comes back at every boot.
 */
export const AUTH_INDEXES: readonly AuthIndex[] = [
  // The cookie's own value, read by every guard.
  { collection: "session", key: { token: 1 }, options: { name: "session_token_uidx", unique: true } },
  // Each of these three names is the one production's hand-made index carries, which can change there
  // without us: a same-key index under another name refuses the build with code 85.
  { collection: "session", key: { expiresAt: 1 }, options: { name: "expiresAt_1", expireAfterSeconds: 0 } },
  { collection: "passkey", key: { credentialID: 1 }, options: { name: "credentialID_1", unique: true } },
  { collection: "verification", key: { expiresAt: 1 }, options: { name: "expiresAt_1", expireAfterSeconds: 0 } },
  // Unique, or a ban ending the sessions of one account at an address leaves a second one's standing.
  { collection: "user", key: { email: 1 }, options: { name: "user_email_uidx", unique: true } },
];

/** The run in flight, which the next waits out, so no two runs build at once. */
let running: Promise<void> = Promise.resolve();

/** Whether a rebuild already waits on the store's recovery, so one outage arms one. */
let rebuildArmed = false;

/**
 * Every build one after another, after any run still in flight. The server runs at most `maxNumActiveUserIndexBuilds`
 * index builds at once, three by default, and blocks the rest until one ends
 * (https://www.mongodb.com/docs/manual/core/index-creation/#maximum-concurrent-index-builds). A blocked build waits
 * inside the client's socket bound, and the adapter's own builds count against the same limit, so a run holds at most
 * one of them. Never rejects, so the boot's unawaited call leaves no rejection unhandled.
 */
export function buildAuthIndexes(): Promise<void> {
  running = running.then(buildOnce);
  return running;
}

async function buildOnce(): Promise<void> {
  const database = signInStore().db(MONGO_DB_NAME);

  for (const { collection, key, options } of AUTH_INDEXES) {
    try {
      // Under the client's socket bound like every call: a build outlasting it is logged unbuilt and asked for again on
      // the next writable heartbeat.
      await database.collection(collection).createIndex(key, options, undefined);
    } catch (failed) {
      logUnbuilt(options.name, failed);
      // No server code is a store that did not answer, or answered slower than the client waits, which judged no index;
      // a server code is the store's verdict, which asking again only repeats.
      if (!(failed instanceof MongoServerError)) rebuildOnRecovery();
    }
  }
}

/**
 * The build runs again on the next heartbeat a writable server answers, rather than waiting for the next boot
 * (`serverHeartbeatSucceeded`, https://www.mongodb.com/docs/drivers/node/current/monitoring-and-logging/monitoring/).
 * A store that did not answer fails its heartbeats until it is back, and the client reconnects on its own. A store that
 * stayed writable but timed out answers its next one, within the client's heartbeat interval: "If there is a network
 * timeout on the connection after the handshake completes, the client MUST NOT mark the server Unknown"
 * (https://github.com/mongodb/specifications/blob/master/source/server-discovery-and-monitoring/server-discovery-and-monitoring.md#network-error-when-reading-or-writing),
 * so its topology never changes. While a store stays that slow, each run ends in its lines and the next heartbeat
 * starts another, until it answers.
 */
function rebuildOnRecovery(): void {
  if (rebuildArmed) return;
  rebuildArmed = true;
  const store = signInStore();
  const recovered = ({ reply }: ServerHeartbeatSucceededEvent): void => {
    if (reply["isWritablePrimary"] !== true) return;
    store.off("serverHeartbeatSucceeded", recovered);
    rebuildArmed = false;
    void buildAuthIndexes();
  };
  store.on("serverHeartbeatSucceeded", recovered);
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
