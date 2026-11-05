import { randomUUID } from "node:crypto";

import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/test-support/actionDoubles.ts";
import {
  ADMIN_EMAIL,
  Barrier,
  BARRIER_TIMEOUT_MS,
  configDouble,
  cookieHeader,
  ORIGIN,
  overriding,
  registerAuthDoubles,
  signInByCode,
} from "@/test-support/authDoubles.ts";
import { replicaSetUrl, startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

// A replica set: the property under test is a transaction's.
const { mongod, closing } = await startJudgedReplicaSet();

// The set advertises its container-internal address, which topology discovery would follow and find nothing.
const MONGO_URL = replicaSetUrl(mongod);

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db.ts";

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
const DB_DOUBLE = overriding(PRODUCTION_DB, {
  signInStore: (db) => {
    productionClient = (db.signInStore as () => object)();
    const wrapped = new Proxy(productionClient as object, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop === "db") return (name: string, options?: unknown) => wrapDb((value as Method).call(target, name, options) as object);
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

/** The work each removal owes behind its answer, its notice among it, which a case runs once the answers are in. */
const behind: (() => unknown)[] = [];

const { sent } = registerAuthDoubles({
  core: { config: configDouble({}, { mongodbUri: () => MONGO_URL }), db: DB_DOUBLE, logging: LOGGING_DOUBLE },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/cache": NEXT_CACHE_DOUBLE,
    // This replaces `fl_frontend/src/test-support/setup.ts`'s double of the package whole, so it carries that file's
    // resolved `connection`, which the person lane's session read waits on.
    "next/server": async () => ({
      ...(await vi.importActual<object>("next/server")),
      connection: () => Promise.resolve(),
      after: (work: () => unknown) => void behind.push(work),
    }),
  },
});

/** Runs what the answered removals owe behind their answers. */
async function runBehind(): Promise<void> {
  await Promise.all(behind.splice(0).map((work) => work()));
}

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

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth } = await import("@/core/auth/library");
const { buildAuthIndexes } = await import("@/core/authIndexes");
const { removePasskeyAction } = await import("./actions.ts");

type Collection = {
  find: (filter: object) => { toArray: () => Promise<Record<string, unknown>[]> };
  updateMany: (filter: object, update: object) => Promise<unknown>;
};
type RealClient = {
  db: (name: string) => { dropDatabase: () => Promise<unknown>; collection: (name: string) => Collection };
  close: () => Promise<void>;
};

const realClient = productionClient as RealClient;
closing(() => realClient.close());
const authDb = () => realClient.db("auth");

beforeEach(async () => {
  barrier.disarm();
  warnings.length = 0;
  signingOut = async () => undefined;
  readGate = OPEN_GATE;
  await authDb().dropDatabase();

  // Production's indexes under every case, so the library is driven over what it meets there.
  errors.length = 0;
  await buildAuthIndexes();
  expect(errors, "an index of the sign-in store was left unbuilt").toStrictEqual([]);
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
 * is the acting device's own passkey, which every guard asks for.
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
  const answers = await Promise.all(ids.map((id) => removePasskeyAction({ id, holder: ADMIN_EMAIL })));
  barrier.disarm();
  assert.ok(await barrier.filled, "the removals were not all held at `passkey.deleteOne` or `user.findOneAndUpdate`, so no race was run");
  await runBehind();
  return {
    successes: answers.map((answer) => answer.ok).sort(),
    refusals: answers.flatMap((answer) => (answer.ok ? [] : [answer.reason])),
    notices: sent.length - mailedBefore,
    warnings: [...warnings],
    rows: (await passkeyRows()).length,
  };
}

const { COPY } = await import("@/core/copy.ts");

const LAST_PASSKEY = COPY.account.passkeys.lastKept;

/** A removal the store failed under, whatever became of it. */
const UNEXPECTED = { ok: false, reason: COPY.shared.failure.unexpected };

/**
 * One removal stands. The other's claim conflicts with it, and the run the adapter retries on a fresh
 * snapshot answers on what the first left, on no line of its own.
 */
const ONE_WINS = { successes: [false, true], notices: 1, warnings: [] };

describe("two removals by one administrator at once, against a real database", () => {
  it("keeps the last row when two removals start from two rows, refusing the second as the last", async () => {
    const { cookie, userId } = await steppedUpAdmin();
    const ids = await seedPasskeys(userId, 2);

    expect(await removeAtOnce(cookie, ids)).toStrictEqual({ ...ONE_WINS, refusals: [LAST_PASSKEY], rows: 1 });
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
      const second = removePasskeyAction({ id: held, holder: ADMIN_EMAIL });
      assert.ok(await gate.reached, "the held removal never reached its in-transaction read");

      const first = await removePasskeyAction({ id: through, holder: ADMIN_EMAIL });
      gate.release();

      expect({ first: first.ok, second: await second, rows: (await passkeyRows()).length }).toStrictEqual({
        first: true,
        second: { ok: false, reason: LAST_PASSKEY },
        rows: 1,
      });
    } finally {
      gate.release();
    }
  });
});

/** The passkey a removal below takes away, and the device it signed in; the acting device signed in with another. */
const REMOVED = "fl-passkey-db-entfernt";

/** A third passkey, which signed in a device of its own and stays. */
const KEPT = "fl-passkey-db-behalten";

describe("the sessions a removal ends, against a real database", () => {
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

    cacheCalls.length = 0;
    expect(await removePasskeyAction({ id: first, holder: ADMIN_EMAIL })).toStrictEqual({ ok: true, value: "otherDevices" });
    expect([await opens(other.cookie), await opens(third.cookie), await opens(byCode), await opens(own.cookie)]).toStrictEqual([
      false,
      true,
      true,
      true,
    ]);
    // Another device's passkey: this page reads the sign-in store again, which nothing cached holds.
    expect(cacheCalls.map(({ name }) => name)).toStrictEqual(["refresh"]);
  });

  /* Another device's `updatedAt` refresh, landing while the sign-out runs on every run the adapter
     retries: the delete before the sign-out rolls back with it rather than standing alone, until the
     client's `timeoutMS` ends the retries. */
  it("rolls the removal back whole where every run's sign-out meets another write to the sessions", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2, [REMOVED]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });
    signingOut = () =>
      authDb()
        .collection("session")
        .updateMany({}, { $set: { updatedAt: new Date() } });

    const answer = await removePasskeyAction({ id: first, holder: ADMIN_EMAIL });

    expect({
      answer: answer,
      rows: (await passkeyRows()).length,
      open: [await opens(other.cookie), await opens(own.cookie)],
      warnings: [...warnings],
    }).toStrictEqual({ answer: UNEXPECTED, rows: 2, open: [true, true], warnings: [] });
  });

  // A failure the adapter does not retry rolls the delete back with it, before any commit.
  it("rolls back and answers the generic failure where the sign-out fails for another reason", async () => {
    const other = await steppedUpAdmin(REMOVED);
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2, [REMOVED]);
    assert.ok(first);
    requestHeaders = new Headers({ ...ORIGIN, cookie: own.cookie });
    signingOut = async () => {
      throw new Error("planted");
    };

    const answer = await removePasskeyAction({ id: first, holder: ADMIN_EMAIL });

    expect({
      answer: answer,
      rows: (await passkeyRows()).length,
      open: [await opens(other.cookie), await opens(own.cookie)],
      warnings: [...warnings],
    }).toStrictEqual({ answer: UNEXPECTED, rows: 2, open: [true, true], warnings: [] });
  });
});
