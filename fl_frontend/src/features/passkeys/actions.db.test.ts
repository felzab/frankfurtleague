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
  cookieHeader,
  lastMailedToken,
  ORIGIN,
  registerAuthDoubles,
} from "@/core/authDoubles.ts";

// A replica set, which the module starts by default: the property under test is a transaction's.
const mongod = await new MongoDBContainer("mongo:8").start();

// The set advertises its container-internal address, which topology discovery would follow and find nothing.
const MONGO_URL = `${mongod.getConnectionString()}/?directConnection=true`;

const REQUEST_HEADERS = "__flPasskeyDbRequestHeaders";
const SENT = "__flPasskeyDbSentMail";
const LOGGED = "__flPasskeyDbLogged";
const BARRIER = "__flPasskeyDbBarrier";
const SIGNING_OUT = "__flPasskeyDbSigningOut";
const REAL_CLIENT = "__flPasskeyDbRealClient";
const COMMITTED = "__flPasskeyDbCommitted";
const GATE = "__flPasskeyDbGate";

/* The real client, held where a removal makes its first write after its judgement: the passkey row
   where nothing claims the account, the account's own row where something does. The session
   `deleteMany` runs `signingOut` first, inside the removal's transaction. */
const DB_DOUBLE = `import mongodb from ${JSON.stringify(import.meta.resolve("mongodb"))};
const real = new mongodb.MongoClient(${JSON.stringify(MONGO_URL)});
globalThis.${REAL_CLIENT} = real;
const bound = (target, value) => (typeof value === "function" ? value.bind(target) : value);
const HELD = { passkey: "deleteOne", user: "findOneAndUpdate" };
const wrapCollection = (name, collection) => new Proxy(collection, { get(target, prop) {
  if (HELD[name] === prop) return async (...args) => { await globalThis.${BARRIER}.arrive(); return target[prop](...args); };
  if (name === "passkey" && prop === "aggregate") return (pipeline, options) => {
    const cursor = target.aggregate(pipeline, options);
    if (!options || !options.session) return cursor;
    return new Proxy(cursor, { get(c, p) {
      if (p === "toArray") return async () => { await globalThis.${GATE}.arrive(); return c.toArray(); };
      return bound(c, Reflect.get(c, p, c));
    }});
  };
  if (name === "session" && prop === "deleteMany") return async (...args) => { await globalThis.${SIGNING_OUT}(); return target[prop](...args); };
  return bound(target, Reflect.get(target, prop, target));
}});
const wrapDb = (db) => new Proxy(db, { get(target, prop) {
  if (prop === "collection") return (name, options) => wrapCollection(name, target.collection(name, options));
  return bound(target, Reflect.get(target, prop, target));
}});
export const client = new Proxy(real, { get(target, prop) {
  if (prop === "db") return (name, options) => wrapDb(target.db(name, options));
  if (prop === "startSession") return (...args) => {
    const session = target.startSession(...args);
    const commit = session.commitTransaction.bind(session);
    session.commitTransaction = async () => { const done = await commit(); await globalThis.${COMMITTED}(); return done; };
    return session;
  };
  return bound(target, Reflect.get(target, prop, target));
}});`;

const MAIL_DOUBLE = `export const sendMail = async (message) => { globalThis.${SENT}.push(message); return { id: null }; };`;
const HEADERS_DOUBLE = `export const headers = async () => globalThis.${REQUEST_HEADERS};`;

// `refresh()` throws outside a request Next itself is rendering.
const CACHE_DOUBLE = `export const refresh = () => {};`;

const LOGGING_DOUBLE = `export const logger = {
  debug: () => {},
  info: () => {},
  warn: (message) => globalThis.${LOGGED}.push(message),
  error: () => {},
};`;

registerAuthDoubles({
  core: { db: DB_DOUBLE, mail: MAIL_DOUBLE, logging: LOGGING_DOUBLE },
  specifiers: { "next/headers": asDataUrl(HEADERS_DOUBLE), "next/cache": asDataUrl(CACHE_DOUBLE) },
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

const sent: { to: string; text: string }[] = [];
const warnings: string[] = [];
const barrier = new Barrier();
const globals = globalThis as unknown as Record<string, unknown>;
globals[SENT] = sent;
globals[LOGGED] = warnings;
globals[BARRIER] = barrier;
globals[GATE] = OPEN_GATE;

/** What runs as a removal reaches its sign-out: inside its transaction, after its delete. */
let signingOut: () => Promise<unknown> = async () => undefined;
globals[SIGNING_OUT] = () => signingOut();

/** What runs once a removal's commit has been taken by the server, before its answer reaches the removal. */
let committed: () => Promise<unknown> = async () => undefined;
globals[COMMITTED] = () => committed();

// Imported after the hooks above are registered: a static import resolves before they exist.
const { auth } = await import("@/core/auth");
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

const realClient = globals[REAL_CLIENT] as RealClient;
const authDb = () => realClient.db("auth");

after(async () => {
  await realClient.close();
  await mongod.stop();
});

beforeEach(async () => {
  barrier.disarm();
  sent.length = 0;
  warnings.length = 0;
  signingOut = async () => undefined;
  committed = async () => undefined;
  globals[GATE] = OPEN_GATE;
  await authDb().dropDatabase();
});

/** The administrator the dialog acts as, the passkey having made the session just now. */
async function steppedUpAdmin(): Promise<{ cookie: string; userId: string }> {
  await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
  const verified = await auth.api.magicLinkVerify({
    query: { token: lastMailedToken(sent, ADMIN_EMAIL) ?? assert.fail(`nothing was mailed to ${ADMIN_EMAIL}`) },
    headers: new Headers(ORIGIN),
    returnHeaders: true,
  });
  const cookie = cookieHeader(verified);

  await authDb()
    .collection("session")
    .updateMany({}, { $set: { authFactor: "passkey", createdAt: new Date() } });

  const [user] = await authDb().collection("user").find({}).toArray();
  assert.ok(user, "the verification wrote no user row");
  return { cookie, userId: String(user._id) };
}

/** Rows written through the adapter, so they carry the shape the plugin's own writes give them. */
async function seedPasskeys(userId: string, count: number): Promise<string[]> {
  const { adapter } = await auth.$context;
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "passkey",
      data: {
        userId: userId,
        credentialID: `fl-passkey-db-${randomUUID()}`,
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
  globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie });
  const mailedBefore = sent.length;
  barrier.arm(ids.length);
  const answers = await Promise.all(ids.map((id) => removePasskeyAction(id)));
  barrier.disarm();
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
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie });
    const gate = new Gate();
    globals[GATE] = gate;

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

describe("the other sessions a removal ends, against a real database", () => {
  const opens = async (cookie: string) => (await auth.api.getSession({ headers: new Headers({ ...ORIGIN, cookie }) })) !== null;

  it("ends every other session of the administrator and keeps the one the removal ran in", async () => {
    const other = await steppedUpAdmin();
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2);
    assert.ok(first);
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie: own.cookie });

    assert.equal((await removePasskeyAction(first)).success, true);
    assert.deepEqual([await opens(other.cookie), await opens(own.cookie)], [false, true]);
  });

  /* Another device's hourly `updatedAt` refresh, landing while the sign-out runs: the sign-out's own
     write meets it, and the delete before it rolls back with it rather than standing alone. */
  it("answers the conflict and keeps both rows where another session is written during the sign-out", async () => {
    const other = await steppedUpAdmin();
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2);
    assert.ok(first);
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie: own.cookie });
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
    const other = await steppedUpAdmin();
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2);
    assert.ok(first);
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie: own.cookie });
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
    const other = await steppedUpAdmin();
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2);
    assert.ok(first);
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie: own.cookie });
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
    const other = await steppedUpAdmin();
    const own = await steppedUpAdmin();
    const [first] = await seedPasskeys(own.userId, 2);
    assert.ok(first);
    globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie: own.cookie });
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
