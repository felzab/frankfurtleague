import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoServerError } from "mongodb";

import {
  ADMIN_EMAIL,
  asDataUrl,
  Barrier,
  BARRIER_TIMEOUT_MS,
  configDouble,
  cookieHeader,
  ORIGIN,
  registerAuthDoubles,
  signInByCode,
} from "@/core/authDoubles.ts";
import { itLeftNoTransactionToExpire, watchExpiredTransactions } from "@/core/expiredTransactions.ts";
import { overridingModule } from "@/core/exportingModule.ts";
import { NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

// A replica set, which the module starts by default: the property under test is a transaction's.
const mongod = await new MongoDBContainer("mongo:8.3.11").start();
await watchExpiredTransactions(mongod);

// The set advertises its container-internal address, which topology discovery would follow and find nothing.
const MONGO_URL = `${mongod.getConnectionString()}/?directConnection=true`;

// A second URL for the production module, which the load hook's match on a path's end lets past the
// double: the client under test is the one `fl_frontend/src/core/db.ts` builds, Stable API included.
const PRODUCTION_DB = `${import.meta.resolve("@/core/db.ts")}?production`;

type Method = (...args: unknown[]) => unknown;

const bound = (target: object, value: unknown): unknown => (typeof value === "function" ? (value as Method).bind(target) : value);

/** The client `fl_frontend/src/core/db.ts` built, which the double below stands over. */
let productionClient: unknown;

/** What the request a case arrives as carries. */
let requestHeaders: Headers | undefined;

/** The first write each collection makes after a removal's judgement, held at `barrier`. */
const HELD: Readonly<Record<string, string>> = { passkey: "deleteOne", user: "findOneAndUpdate" };

const wrapCollection = (name: string, collection: object): object =>
  new Proxy(collection, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (HELD[name] === prop) {
        return async (...args: unknown[]) => {
          await barrier.arrive();
          return (value as Method).apply(target, args);
        };
      }
      if (name === "passkey" && prop === "aggregate") {
        return (pipeline: unknown, options?: { session?: unknown }) => {
          const cursor = (value as Method).call(target, pipeline, options) as object;
          if (!options?.session) return cursor;
          return new Proxy(cursor, {
            get(c, p) {
              const read: unknown = Reflect.get(c, p, c);
              if (p === "toArray") {
                return async () => {
                  await readGate.arrive();
                  return (read as Method).call(c);
                };
              }
              return bound(c, read);
            },
          });
        };
      }
      if (name === "session" && prop === "deleteMany") {
        return async (...args: unknown[]) => {
          await signingOut();
          return (value as Method).apply(target, args);
        };
      }
      return bound(target, value);
    },
  });

const wrapDb = (db: object): object =>
  new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (prop === "collection")
        return (name: string, options?: unknown) => wrapCollection(name, (value as Method).call(target, name, options) as object);
      return bound(target, value);
    },
  });

/* The real client, held where a removal makes its first write after its judgement: the passkey row
   where nothing claims the account, the account's own row where something does. The session
   `deleteMany` runs `signingOut` first, inside the removal's transaction. */
const DB_DOUBLE = overridingModule(PRODUCTION_DB, {
  signInStore: (db) => {
    productionClient = (db.signInStore as () => object)();
    const wrapped = new Proxy(productionClient as object, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop === "db") return (name: string, options?: unknown) => wrapDb((value as Method).call(target, name, options) as object);
        if (prop === "startSession") {
          return (...args: unknown[]) => {
            const session = (value as Method).apply(target, args) as { commitTransaction: () => Promise<unknown> };
            const commit = session.commitTransaction.bind(session);
            session.commitTransaction = async () => {
              const done = await commit();
              await committed();
              return done;
            };
            return session;
          };
        }
        return bound(target, value);
      },
    });
    return () => wrapped;
  },
});

const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => void warnings.push(message),
    error: (message: string) => void errors.push(message),
  },
};

const { sent } = registerAuthDoubles({
  core: { config: configDouble({ MONGODB_URI: MONGO_URL }), db: DB_DOUBLE, logging: LOGGING_DOUBLE },
  specifiers: { "next/headers": HEADERS_DOUBLE, "next/cache": asDataUrl(NEXT_CACHE_DOUBLE) },
});

/**
 * Holds the first removal whose transaction reads the passkey rows, where its snapshot is taken, until
 * the case lets it go; every read after that one passes.
 */
class Gate {
  private armed = true;
  private letGo: () => void = () => undefined;
  private arrived: () => void = () => undefined;

  /** Whether a removal reached the held read, answered `false` rather than awaited for good. */
  readonly reached = new Promise<boolean>((resolve) => {
    this.arrived = () => resolve(true);
    setTimeout(() => resolve(false), BARRIER_TIMEOUT_MS).unref();
  });

  async arrive(): Promise<void> {
    if (!this.armed) return;
    this.armed = false;
    this.arrived();
    await new Promise<void>((resolve) => {
      this.letGo = resolve;
      setTimeout(resolve, BARRIER_TIMEOUT_MS);
    });
  }

  release(): void {
    this.letGo();
  }
}

/** The gate no case holds: every read passes. */
const OPEN_GATE = { arrive: async () => undefined };

const warnings: string[] = [];
const errors: string[] = [];
const barrier = new Barrier();

/** Where a removal's in-transaction read of the passkey rows waits: nowhere, unless a case holds it. */
let readGate: { arrive: () => Promise<unknown> } = OPEN_GATE;

/** What runs as a removal reaches its sign-out: inside its transaction, after its delete. */
let signingOut: () => Promise<unknown> = async () => undefined;

/** What runs once a removal's commit has been taken by the server, before its answer reaches the removal. */
let committed: () => Promise<unknown> = async () => undefined;

// Imported after the hooks above are registered: a static import resolves before they exist.
const { auth } = await import("@/core/auth");
const { buildAuthIndexes } = await import("@/core/authIndexes");
const { removePasskeyAction } = await import("./actions.ts");
const { UNKNOWN_REFUSAL } = await import("@/shared/utils/refusal");

type Collection = {
  find: (filter: object) => { toArray: () => Promise<Record<string, unknown>[]> };
  updateMany: (filter: object, update: object) => Promise<unknown>;
};
type RealClient = {
  db: (name: string) => { dropDatabase: () => Promise<unknown>; collection: (name: string) => Collection };
  close: () => Promise<void>;
};

const realClient = productionClient as RealClient;
const authDb = () => realClient.db("auth");

after(async () => {
  await realClient.close();
  await mongod.stop();
});

beforeEach(async () => {
  barrier.disarm();
  warnings.length = 0;
  signingOut = async () => undefined;
  committed = async () => undefined;
  readGate = OPEN_GATE;
  await authDb().dropDatabase();

  // Production's indexes under every case, so the library is driven over what it meets there.
  errors.length = 0;
  await buildAuthIndexes();
  assert.deepEqual(errors, [], "an index of the sign-in store was left unbuilt");
});

/** The passkey the acting device signed in with, which `seedPasskeys` writes last unless a case names it. */
const OWN_CREDENTIAL = "fl-passkey-db-eigener";

/**
 * The administrator the account page acts as, signed in just now by the passkey `credentialID` names:
 * the stamp its assertion writes, set on the session this call minted and on no earlier one.
 */
async function steppedUpAdmin(credentialID = OWN_CREDENTIAL): Promise<{ cookie: string; userId: string }> {
  const cookie = cookieHeader(await signInByCode(auth, ADMIN_EMAIL));

  await authDb()
    .collection("session")
    .updateMany(
      { passkeyCredentialId: { $exists: false } },
      { $set: { authFactor: "passkey", passkeyCredentialId: credentialID, createdAt: new Date() } },
    );

  const [user] = await authDb().collection("user").find({}).toArray();
  assert.ok(user, "the verification wrote no user row");
  return { cookie, userId: String(user._id) };
}

/**
 * Rows in the shape the plugin's own writes give them; `credentialIDs` names the first ones. The last
 * is the acting device's own passkey, which every guard asks for (`docs/frontend/spec.md :: I313`).
 */
async function seedPasskeys(userId: string, count: number, credentialIDs: readonly string[] = []): Promise<string[]> {
  const { adapter } = await auth.$context;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "passkey",
      data: {
        userId: userId,
        credentialID: credentialIDs[index] ?? (index === count - 1 ? OWN_CREDENTIAL : `fl-passkey-db-${randomUUID()}`),
        publicKey: "fabricated-public-key",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "internal",
        createdAt: new Date(),
      },
    });
    ids.push(row.id);
  }
  return ids;
}

async function passkeyRows(): Promise<Record<string, unknown>[]> {
  return authDb().collection("passkey").find({}).toArray();
}

/** Two removals from ONE session, which two open dialogs share: both held at their first write. */
async function removeAtOnce(cookie: string, ids: readonly string[]) {
  requestHeaders = new Headers({ ...ORIGIN, cookie });
  const mailedBefore = sent.length;
  barrier.arm(ids.length);
  const answers = await Promise.all(ids.map((id) => removePasskeyAction(id)));
  barrier.disarm();
  assert.ok(await barrier.filled, "the removals were not all held at `passkey.deleteOne` or `user.findOneAndUpdate`, so no race was run");
  return {
    successes: answers.map((answer) => answer.success).sort(),
    refusals: answers.flatMap((answer) => (answer.success ? [] : [answer.error])),
    notices: sent.length - mailedBefore,
    warnings: [...warnings],
    rows: (await passkeyRows()).length,
  };
}

const GLEICHZEITIG_GEAENDERT = "Gleichzeitig wurde an Deinen Passkeys oder Anmeldungen etwas geändert. Lade die Seite neu.";

/** One removal stands and the other is refused as the loser of two changes, on one warning line. */
const ONE_WINS = {
  successes: [false, true],
  refusals: [GLEICHZEITIG_GEAENDERT],
  notices: 1,
  warnings: ["auth.passkey_removal_conflict"],
};

describe("two removals by one administrator at once, against a real database (`docs/frontend/spec.md :: I312`)", () => {
  it("keeps the last row when two removals start from two rows", async () => {
    const { cookie, userId } = await steppedUpAdmin();
    const ids = await seedPasskeys(userId, 2);

    assert.deepEqual(await removeAtOnce(cookie, ids), { ...ONE_WINS, rows: 1 });
  });

  it("removes one row once when the same row is asked for twice at once", async () => {
    const { cookie, userId } = await steppedUpAdmin();
    const [first] = await seedPasskeys(userId, 3);
    assert.ok(first);

    assert.deepEqual(await removeAtOnce(cookie, [first, first]), { ...ONE_WINS, rows: 2 });
  });

  /* The other order: the second removal's snapshot is taken only once the first has committed whole,
     so no claim meets another and only the count inside the transaction keeps the last row. */
  it("keeps the last row where one removal commits whole before the other's transaction reads", async () => {
    const { cookie, userId } = await steppedUpAdmin();
    const [held, through] = await seedPasskeys(userId, 2);
    assert.ok(held && through);
    requestHeaders = new Headers({ ...ORIGIN, cookie });
    const gate = new Gate();
    readGate = gate;

    try {
      const second = removePasskeyAction(held);
      assert.ok(await gate.reached, "the held removal never reached its in-transaction read");

      const first = await removePasskeyAction(through);
      gate.release();

      assert.deepEqual(
        { first: first.success, second: await second, rows: (await passkeyRows()).length },
        { first: true, second: { success: false, error: "Der letzte Passkey lässt sich nicht löschen." }, rows: 1 },
      );
    } finally {
      gate.release();
    }
  });
});

/** The passkey a removal below takes away, and the device it signed in; the acting device signed in with another. */
const REMOVED = "fl-passkey-db-entfernt";

/** A third passkey, which signed in a device of its own and stays. */
const KEPT = "fl-passkey-db-behalten";

describe("the sessions a removal ends, against a real database (`docs/frontend/spec.md :: I313`)", () => {
  const opens = async (cookie: string) => (await auth.api.getSession({ headers: new Headers({ ...ORIGIN, cookie }) })) !== null;

  /* Two devices besides the acting one that the removed passkey did not sign in: ending every session
     but the acting one would also pass a case holding only the removed passkey's. */
  it("ends the session the removed passkey made and keeps those another passkey or a code made", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const third = await steppedUpAdmin(KEPT);
    const own = await steppedUpAdmin();
    const byCode = cookieHeader(await signInByCode(auth, ADMIN_EMAIL));
    const [first] = await seedPasskeys(own.userId, 3, [REMOVED, KEPT]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });

    assert.equal((await removePasskeyAction(first)).success, true);
    assert.deepEqual(
      [await opens(other.cookie), await opens(third.cookie), await opens(byCode), await opens(own.cookie)],
      [false, true, true, true],
    );
  });

  /* Another device's hourly `updatedAt` refresh, landing while the sign-out runs: the sign-out's own
     write meets it, and the delete before it rolls back with it rather than standing alone. */
  it("answers the conflict and keeps both rows where another session is written during the sign-out", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2, [REMOVED]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });
    signingOut = () =>
      authDb()
        .collection("session")
        .updateMany({}, { $set: { updatedAt: new Date() } });

    const answer = await removePasskeyAction(first);

    assert.deepEqual(
      {
        answer: answer,
        rows: (await passkeyRows()).length,
        open: [await opens(other.cookie), await opens(own.cookie)],
        warnings: [...warnings],
      },
      {
        answer: { success: false, error: GLEICHZEITIG_GEAENDERT },
        rows: 2,
        open: [true, true],
        warnings: ["auth.passkey_removal_conflict"],
      },
    );
  });

  /* A stepped-down primary or a lost connection carries the transient label a write conflict does,
     and is not another change to these passkeys: the code decides, and the label never. */
  it("answers a transient failure that is not a write conflict as the generic failure", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2, [REMOVED]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });
    signingOut = async () => {
      // Built rather than raised by the server: the test container refuses `configureFailPoint`.
      throw new MongoServerError({
        message: "planted: the primary stepped down",
        code: 91,
        codeName: "ShutdownInProgress",
        errorLabels: ["TransientTransactionError"],
      });
    };

    const answer = await removePasskeyAction(first);

    assert.deepEqual(
      {
        answer: answer,
        rows: (await passkeyRows()).length,
        open: [await opens(other.cookie), await opens(own.cookie)],
        warnings: [...warnings],
      },
      { answer: { success: false, error: UNKNOWN_REFUSAL }, rows: 2, open: [true, true], warnings: [] },
    );
  });

  // Any other failure at the sign-out rolls back the same way, and is not answered as the conflict:
  // the removal tests the server's code, never the mere fact that its transaction threw.
  it("rolls back and answers the generic failure where the sign-out fails for another reason", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2, [REMOVED]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });
    signingOut = async () => {
      throw new Error("planted");
    };

    const answer = await removePasskeyAction(first);

    assert.deepEqual(
      {
        answer: answer,
        rows: (await passkeyRows()).length,
        open: [await opens(other.cookie), await opens(own.cookie)],
        warnings: [...warnings],
      },
      { answer: { success: false, error: UNKNOWN_REFUSAL }, rows: 2, open: [true, true], warnings: [] },
    );
  });

  /* The commit landed and its answer did not: the rows say the removal stands, and nobody can tell
     that from the throw, so a failure's title would send the administrator to remove it again. */
  it("answers the outcome as unknown where the commit's own answer is lost, the removal standing", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2, [REMOVED]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });
    committed = async () => {
      throw new Error("planted: the commit's answer lost");
    };

    const answer = await removePasskeyAction(first);

    assert.deepEqual(
      {
        answer: answer,
        rows: (await passkeyRows()).length,
        open: [await opens(other.cookie), await opens(own.cookie)],
      },
      {
        answer: {
          success: false,
          error: "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.",
          outcome: "unknown",
        },
        rows: 1,
        open: [false, true],
      },
    );
  });
});

// Last, so every case above has run against the count it reads.
itLeftNoTransactionToExpire(mongod);
