import { NEXT_CACHE_DOUBLE } from "@/test-support/actionDoubles.ts";
import {
  ADMIN_EMAIL,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  lastMailedCode,
  ORIGIN,
  overriding,
  registerAuthDoubles,
  seatEveryAddress,
  signInByCode,
} from "@/test-support/authDoubles.ts";
import { replicaSetUrl, startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { MongoClient, ObjectId } from "mongodb";
import { assert, beforeEach, describe, expect, it } from "vitest";

// A replica set, as the store the library's adapter writes in transactions is. The file's own: the table-scan
// refusal set on it below reaches no other file's store.
const { mongod, closing } = await startJudgedReplicaSet();

/** The client `fl_frontend/src/core/db.ts` builds, once the module has built it. */
let storeClient: MongoClient | undefined;

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db.ts";

const DB_DOUBLE = overriding(PRODUCTION_DB, {
  signInStore: (real) => {
    const client = (real.signInStore as () => MongoClient)();
    storeClient = client;
    closing(() => client.close());
    return () => client;
  },
});

/** Each error line written, as the logger was handed it. */
const errors: { event: string; fields: unknown }[] = [];

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (event: string, _error: unknown, fields: unknown) => void errors.push({ event, fields }),
  },
};

/** What the request a case arrives as carries. */
let requestHeaders: Headers | undefined;

// A seat for every address: the case below signs a person in, whose session the gate admits on a held seat.
seatEveryAddress();

const { sent } = registerAuthDoubles({
  core: {
    config: configDouble(GATE_BACKEND_CONFIG, { mongodbUri: () => replicaSetUrl(mongod) }),
    db: DB_DOUBLE,
    logging: LOGGING_DOUBLE,
  },
  specifiers: {
    "next/headers": { headers: () => Promise.resolve(requestHeaders) },
    // What the account page's spine calls once an action has written, which throws outside a server action.
    "next/cache": NEXT_CACHE_DOUBLE,
  },
});

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth } = await import("./auth/library.ts");
const { endOtherSessions } = await import("./auth/accountSessions.ts");
const { getAccountSession } = await import("./auth/guards.ts");
const { passkeysOf } = await import("./auth/passkeys.ts");
const { buildAuthIndexes } = await import("./authIndexes.ts");

const store = () => (storeClient as MongoClient).db("auth");
const COLLECTIONS = ["session", "passkey", "user", "verification"] as const;

beforeEach(async () => {
  errors.length = 0;
  requestHeaders = undefined;
  await store().dropDatabase();
});

/** Every index the four collections hold, by collection, as `listIndexes` answers them. */
async function heldIndexes(): Promise<Record<string, Record<string, unknown>[]>> {
  const held: Record<string, Record<string, unknown>[]> = {};
  for (const collection of COLLECTIONS) held[collection] = await store().collection(collection).indexes();
  return held;
}

/** A person rather than an administrator, whose sessions by a mailed code the account page serves. */
const PERSON = "person@example.org";

/** The server's code for a query it refused to plan while table scans are disabled. */
const NO_QUERY_EXECUTION_PLANS = 291;

// The server parameter is outside the Stable API the production client is held to, so it is set over a
// client of the suite's own.
const operator = new MongoClient(replicaSetUrl(mongod));
closing(() => operator.close());

/** Runs `body` with table scans refused, and allowed again after it whatever it did. */
async function refusingTableScans<T>(body: () => Promise<T>): Promise<T> {
  await operator.db("admin").command({ setParameter: 1, notablescan: true });
  try {
    return await body();
  } finally {
    await operator.db("admin").command({ setParameter: 1, notablescan: false });
  }
}

describe("the reads a visitor can multiply, with table scans refused", () => {
  /* `verification` grows with every code anybody asks for, and a scan in each send and check would slow every
     sign-in with it; an account's passkeys are read after every sign-in, to offer or ask one. Driven through the
     library's own queries rather than an `explain` of a query shaped like them, which the next upgrade would leave behind. */
  it("plans a code's send and check and an account's passkeys on an index", async () => {
    await buildAuthIndexes();
    expect(errors, "an index was left unbuilt, so the reads below ran without it").toStrictEqual([]);

    await refusingTableScans(async () => {
      // The control: without it a parameter the server ignored would pass everything below.
      await expect(store().collection("session").find({ authFactor: "code" }).toArray()).rejects.toSatisfy(
        (failed: { code?: unknown }) => failed.code === NO_QUERY_EXECUTION_PLANS,
      );

      const headers = new Headers(ORIGIN);
      await auth.api.sendVerificationOTP({ body: { email: PERSON, type: "sign-in" }, headers });
      const code = lastMailedCode(sent, PERSON);
      assert.ok(code !== null, "the send mailed nothing, so no code was checked");
      // A wrong guess, counted against the code, and then the code itself.
      await expect(
        auth.api.signInEmailOTP({ body: { email: PERSON, otp: code === "000000" ? "111111" : "000000" }, headers }),
      ).rejects.toSatisfy((failed: { body?: { code?: unknown } }) => failed.body?.code === "INVALID_OTP");
      await auth.api.signInEmailOTP({ body: { email: PERSON, otp: code }, headers });
      const user = await store().collection("user").findOne({ email: PERSON });
      assert.ok(user, "the code signed nobody in, so no account's passkeys are listed");
      const userId = String(user._id);

      // Written through the library's adapter, so the row is in the shape the plugin's own writes give it.
      const { adapter } = await auth.$context;
      await adapter.create({
        model: "passkey",
        data: {
          userId,
          credentialID: "fl-index-db-credential",
          publicKey: "fabricated-public-key",
          counter: 0,
          deviceType: "singleDevice",
          backedUp: false,
          transports: "internal",
          createdAt: new Date(),
        },
      });
      expect((await passkeysOf(userId)).map(({ credentialID }) => credentialID)).toStrictEqual(["fl-index-db-credential"]);
    });
  });
});

describe("ending every other session on a real store", () => {
  /* Every other suite stands in for `endOtherSessions`: the adapter's conversion of both ids is met here alone. */
  it("ends every other session and keeps its own", async () => {
    const kept = cookieHeader(await signInByCode(auth, PERSON));
    requestHeaders = new Headers({ ...ORIGIN, cookie: kept });
    await signInByCode(auth, PERSON);
    await signInByCode(auth, PERSON);
    const served = await getAccountSession();
    assert.ok(served, "the account page refused the session");
    const sessions = store().collection("session");
    const owned = { userId: new ObjectId(served.user.id) };
    expect(await sessions.countDocuments(owned), "fewer than three sessions stood, so the ending proves nothing").toBe(3);

    await endOtherSessions(served.user.id, served.session.id);

    const standing = await sessions.find(owned).toArray();
    expect(
      standing.map(({ _id }) => String(_id)),
      "another device's session stood past the ending, or the kept one went",
    ).toStrictEqual([served.session.id]);
  });
});

describe("the index build against a real store", () => {
  // Production's hand-made indexes are the case: one standing under another name refuses its build.
  it("logs a same-key index standing under another name, and builds every other", async () => {
    await buildAuthIndexes();
    const reference = await heldIndexes();
    await store().dropDatabase();
    await store().collection("session").createIndex({ token: 1 }, { unique: true, name: "made_by_hand" }, undefined);

    await buildAuthIndexes();

    expect(errors.length, JSON.stringify(errors)).toBe(1);
    expect(errors[0]).toStrictEqual({
      event: "auth.index_unbuilt",
      fields: { index: "session_token_uidx", name: "MongoServerError", code: 85, codeName: "IndexOptionsConflict" },
    });
    const names = (held: Record<string, Record<string, unknown>[]>) =>
      Object.entries(held).flatMap(([collection, indexes]) => indexes.map(({ name }) => `${collection}.${String(name)}`));
    expect(names(await heldIndexes()).sort()).toStrictEqual(
      [...names(reference).filter((name) => name !== "session.session_token_uidx"), "session.made_by_hand"].sort(),
    );
  });

  /* Read off the library's own schema rather than the list, so a field it declares unique, or an
     expiry it writes, is held to an index whether or not anybody declared one. */
  it("holds every field the library declares unique to a unique index, and every expiry it writes to an expiring one", async () => {
    await buildAuthIndexes();
    const held = await heldIndexes();
    const { tables } = await auth.$context;

    const served = Object.values(tables).filter(({ modelName }) => (COLLECTIONS as readonly string[]).includes(modelName));
    expect(served.map(({ modelName }) => modelName).sort(), "a collection the store holds has no table here").toStrictEqual(
      [...COLLECTIONS].sort(),
    );

    for (const { modelName, fields } of served) {
      const indexes = held[modelName] ?? [];
      for (const [field, attribute] of Object.entries(fields)) {
        const column = attribute.fieldName ?? field;
        const on = indexes.filter(({ key }) => JSON.stringify(key) === JSON.stringify({ [column]: 1 }));
        if (attribute.unique === true)
          assert.ok(
            on.some(({ unique }) => unique === true),
            `${modelName}.${column} is unique without an index`,
          );
        if (column === "expiresAt" && attribute.type === "date")
          assert.ok(
            on.some(({ expireAfterSeconds }) => expireAfterSeconds === 0),
            `${modelName}.${column} expires nothing`,
          );
      }
    }
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
