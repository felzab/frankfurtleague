import { assert, beforeEach, describe, expect, it } from "vitest";

import { ADMIN_EMAIL, configDouble, ORIGIN, overriding, registerAuthDoubles, signInByCode } from "@/test-support/authDoubles";
import { replicaSetUrl, startReplicaSet } from "@/test-support/replicaSet";
import { captureLog } from "@/test-support/stdoutCapture";

import type { MongoClient } from "mongodb";

// A replica set, as the store the library's adapter writes in transactions is.
const { mongod, closing } = await startReplicaSet();

/** The client `fl_frontend/src/core/db.ts` builds, once the module has built it. */
let storeClient: MongoClient | undefined;

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db";

const DB_DOUBLE = overriding(PRODUCTION_DB, {
  signInStore: (real) => {
    const client = (real.signInStore as () => MongoClient)();
    storeClient = client;
    closing(() => client.close());
    return () => client;
  },
});

/** Every line the real logger writes, read off standard output. */
const log = captureLog();

/** Each error line written, by its event and fields. */
const errorLines = () => log.lines().flatMap(({ level, message, fields }) => (level === "ERROR" ? [{ event: message, fields }] : []));

registerAuthDoubles({
  core: {
    config: configDouble({}, { mongodbUri: () => replicaSetUrl(mongod) }),
    db: DB_DOUBLE,
  },
});

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth } = await import("./auth/library");
const { AUTH_INDEXES, buildAuthIndexes, MONGO_DB_NAME } = await import("./authIndexes");

const store = () => (storeClient as MongoClient).db(MONGO_DB_NAME);
const COLLECTIONS = ["session", "passkey", "user", "verification"] as const;

beforeEach(async () => {
  await store().dropDatabase();
});

/**
 * How long a case waits for the store to hold the indexes a build asked for: past the client's three-second bound a
 * call is logged unbuilt and asked for again on the next writable heartbeat, the driver's ten seconds apart.
 */
const HELD_WITHIN_MS = 30_000;

/** Every index the four collections hold, by collection, as `listIndexes` answers them. */
async function heldIndexes(): Promise<Record<string, Record<string, unknown>[]>> {
  const held: Record<string, Record<string, unknown>[]> = {};
  for (const collection of COLLECTIONS) held[collection] = await store().collection(collection).indexes();
  return held;
}

describe("the index build against a real store", () => {
  // Production's hand-made indexes are the case: one standing under another name refuses its build.
  it("logs a same-key index standing under another name, and builds every other", async () => {
    await store().collection("session").createIndex({ token: 1 }, { unique: true, name: "made_by_hand" }, undefined);

    await buildAuthIndexes();

    // The store's verdicts alone: a build the client stopped waiting for on a loaded machine is logged with no code, and
    // asked for again on the next writable heartbeat.
    expect(errorLines().filter(({ fields }) => fields["code"] !== undefined)).toStrictEqual([
      {
        event: "auth.index_unbuilt",
        fields: { index: "session_token_uidx", name: "MongoServerError", code: 85, codeName: "IndexOptionsConflict" },
      },
    ]);
    const expected = [
      ...COLLECTIONS.map((collection) => `${collection}._id_`),
      ...AUTH_INDEXES.map(({ collection, options }) => `${collection}.${options.name}`).filter((name) => name !== "session.session_token_uidx"),
      "session.made_by_hand",
    ].sort();
    const held = async () =>
      Object.entries(await heldIndexes())
        .flatMap(([collection, indexes]) => indexes.map(({ name }) => `${collection}.${String(name)}`))
        .sort();
    await expect.poll(held, { timeout: HELD_WITHIN_MS, interval: 200 }).toStrictEqual(expected);
  });

  // An expiry stored as anything but a date is never deleted by its index, and nothing reports it.
  it("stores every expiry the library writes as a date", async () => {
    await buildAuthIndexes();
    await signInByCode(auth, ADMIN_EMAIL);
    // A code mailed and never typed, and the send's own counts, stay behind in `verification`.
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) });

    for (const collection of ["session", "verification"] as const) {
      const rows = store().collection(collection);
      assert.ok((await rows.countDocuments()) > 0, `nothing was written to ${collection}, so nothing is compared`);
      expect(await rows.countDocuments({ expiresAt: { $not: { $type: "date" } } }), `${collection} holds an expiry no index deletes`).toBe(0);
    }
  });
});
