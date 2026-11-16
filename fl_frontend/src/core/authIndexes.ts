import "server-only";

import { MongoError, MongoNetworkTimeoutError, MongoServerError } from "mongodb";

import { now } from "./clock";
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

/**
 * How long a run asks again for a build the store has not answered. Without it a build that never answers would hold
 * `running`, and every rebuild queued behind it.
 */
const ANSWERED_WITHIN_MS = 180_000;

/**
 * The codes of a server answering while it changes role, an election's or a shutdown's, which judge no index: the SDAM
 * specification's "not writable primary" and "node is recovering" errors, matched by code alone, as the specification
 * requires where the reply carries one
 * (https://github.com/mongodb/specifications/blob/master/source/server-discovery-and-monitoring/server-discovery-and-monitoring.md#not-writable-primary-and-node-is-recovering).
 * The driver implements the same set as its `isStateChangeError`, which it does not export.
 */
const STATE_CHANGE_CODES: ReadonlySet<number> = new Set([
  // Not writable primary: NotWritablePrimary, NotPrimaryNoSecondaryOk, LegacyNotPrimary.
  10107, 13435, 10058,
  // Node is recovering: InterruptedAtShutdown, InterruptedDueToReplStateChange, NotPrimaryOrSecondary,
  // PrimarySteppedDown, ShutdownInProgress.
  11600, 11602, 13436, 189, 91,
]);

async function buildOnce(): Promise<void> {
  const database = signInStore().db(MONGO_DB_NAME);
  const lanes = Map.groupBy(AUTH_INDEXES, (index) => index.collection);
  const askUntil = now().getTime() + ANSWERED_WITHIN_MS;

  let unbuilt = 0;
  await Promise.all(
    [...lanes].map(async ([collection, indexes]) => {
      for (const { key, options } of indexes) {
        const failed = await failureOf(() => database.collection(collection).createIndex(key, options, undefined), askUntil);
        if (failed === undefined) continue;
        unbuilt += 1;
        logUnbuilt(options.name, failed);
        // Neither a store that did not answer, which carries no server code, nor a server changing role judged the
        // index, so its recovery asks again; every other code is the store's verdict, which asking again only repeats.
        if (!(failed instanceof MongoServerError) || STATE_CHANGE_CODES.has(Number(failed.code))) rebuildOnRecovery();
      }
    }),
  );
  // The run's verdict, which a reader waits for rather than for a time: until it is written, a lane may still be
  // asking, and its line still to come.
  logger.info("auth.indexes_settled", { built: AUTH_INDEXES.length - unbuilt, unbuilt });
}

/**
 * `undefined` once the store answers the build, or the failure standing for its verdict. Each call is under the
 * client's socket bound, and a timeout is no verdict: the server goes on building after the client stops waiting, and
 * the same `createIndex` waits for a build already under way and answers with its outcome. So a timeout is asked
 * again, until `askUntil`.
 */
async function failureOf(build: () => Promise<unknown>, askUntil: number): Promise<unknown> {
  for (;;) {
    try {
      await build();
      return undefined;
    } catch (failed) {
      if (!(failed instanceof MongoNetworkTimeoutError) || now().getTime() >= askUntil) return failed;
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
 * so its topology never changes. While a store stays that slow, each window ends in its lines and the next heartbeat
 * starts another, until it answers. A server that changed role is one the driver marks unknown and checks at once, and
 * the first writable heartbeat after it is the new primary's.
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
