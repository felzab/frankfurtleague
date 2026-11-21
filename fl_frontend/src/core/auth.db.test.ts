import { randomUUID } from "node:crypto";

import { MongoServerError, ObjectId } from "mongodb";
import { assert, beforeEach, describe, expect, it } from "vitest";

import {
  ADMIN_EMAIL,
  Barrier,
  configDouble,
  cookieHeader,
  lastMailedCode,
  ORIGIN,
  overriding,
  registerAuthDoubles,
  signInByCode,
} from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { emptyStore } from "@/test-support/emptyStore";
import { replicaSetUrl, startReplicaSet } from "@/test-support/replicaSet";
import { signInIndexesForTheFile } from "@/test-support/signInIndexes";
import { captureLog } from "@/test-support/stdoutCapture";
import { answerAt, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures";
import { registrationFor } from "@/test-support/testAuthenticator";

import type { LookupFixture } from "@/test-support/subjectFixtures";
import type { MongoClient } from "mongodb";

// A replica set.
const { mongod, closing } = await startReplicaSet();

// The set advertises its container-internal address, which topology discovery would follow and find nothing.
const MONGO_URL = replicaSetUrl(mongod);

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db";

type Method = (...args: unknown[]) => unknown;

const bound = (target: object, value: unknown): unknown => (typeof value === "function" ? (value as Method).bind(target) : value);

/** The client `fl_frontend/src/core/db.ts` built, which the double below stands over. */
let productionClient: unknown;

/** The first write each collection makes after a request's judgement, held at `barrier`. */
const HELD: Readonly<Record<string, string>> = { passkey: "insertOne" };

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
      // A bound's count, which the Mongo adapter runs as an aggregate ending in `$count`: held so a
      // burst of requests all reach it before any reads it.
      if (name === "verification" && prop === "aggregate") {
        return (...args: unknown[]) => {
          // A cursor, returned at once: the wait belongs to its `toArray`, where the count is read.
          const cursor = (value as Method).apply(target, args) as { toArray: () => Promise<unknown> };
          if (!JSON.stringify(args[0] ?? []).includes('"$count"')) return cursor;
          return {
            toArray: async () => {
              await counting.arrive();
              return cursor.toArray();
            },
          };
        };
      }
      if (name === "account" && prop === "deleteMany") {
        return async (...args: unknown[]) => {
          await deletingAccounts();
          return (value as Method).apply(target, args);
        };
      }
      if (name === "user" && prop === "deleteOne") {
        return async (...args: unknown[]) => {
          await deletingUser();
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

/* The real client, held where a request makes its first write after its judgement: the passkey row. Each
   transaction's commit asks `atCommit` first. */
const DB_DOUBLE = overriding(PRODUCTION_DB, {
  signInStore: (db) => {
    productionClient = (db.signInStore as () => object)();
    const wrapped = new Proxy(productionClient as object, {
      get(target, prop) {
        const value: unknown = Reflect.get(target, prop, target);
        if (prop === "db") return (name: string, options?: unknown) => wrapDb((value as Method).call(target, name, options) as object);
        if (prop === "startSession") {
          return (...args: unknown[]) => {
            const session = (value as Method).apply(target, args) as HeldSession;
            const commit = session.commitTransaction.bind(session);
            session.commitTransaction = async () => {
              await atCommit(session);
              return commit();
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

type HeldSession = { commitTransaction: () => Promise<unknown>; abortTransaction: () => Promise<unknown> };

/** What runs as a transaction's commit is asked for, before it is sent. */
let atCommit: (session: HeldSession) => Promise<unknown> = async () => undefined;

/** What runs as an account's sign-in rows are deleted inside a deletion's transaction. */
let deletingAccounts: () => Promise<unknown> = async () => undefined;

/** What runs as a user row is deleted, by the library or by a deletion's transaction. */
let deletingUser: () => Promise<unknown> = async () => undefined;

/** What the request a guard reads carries; a case sets it and `beforeEach` resets it. */
let requestHeaders: Headers | undefined;

const { sent } = registerAuthDoubles({
  // The admin key the person lane's erasure is sent under, beside the store's address.
  core: {
    config: configDouble({}, { mongodbUri: () => MONGO_URL, internalApiKeyAdmin: () => "fabricated-admin-not-a-credential" }),
    db: DB_DOUBLE,
  },
  specifiers: { "next/headers": { headers: () => Promise.resolve(requestHeaders) } },
});

/** What the sign-in gate's backend read answers every address; a case sets it and `beforeEach` resets it. */
let gateAnswer: Pick<LookupFixture, "seats" | "barred" | "account"> = { seats: [], barred: false, account: false };

/** The path a person's own erasure posts to, which the library's hook asks before it deletes the account. */
const ERASURE_PATH = "/api/identity/self/erasure";

/** How many erasures the backend has been asked for. */
let erasuresAsked = 0;

/** A second administrator, for the account a credential the first holds is enrolled on again. */
const SECOND_ADMIN_EMAIL = "zweite-verwaltung@example.org";

// The backend alone: a request to any other host fails its case.
serveBackend(({ path: endpoint, body }) => {
  // Under the base path the client sends it on, as the cases spell every path they compare.
  const path = `/api${endpoint}`;
  if (path === ERASURE_PATH) {
    erasuresAsked += 1;
    return new Response(null, { status: 204 });
  }

  // The grant is what makes `ADMIN_EMAIL` and `SECOND_ADMIN_EMAIL` administrators'; every other address holds none.
  const { email } = (body ?? {}) as { email?: string };
  const granted = email === ADMIN_EMAIL || email === SECOND_ADMIN_EMAIL;
  return answerAt(path, {
    ...NO_RECORDS,
    admin_tier: granted ? "administration" : null,
    // Before every session a case makes.
    granted_since: granted ? "2026-01-01T00:00:00Z" : null,
    ...gateAnswer,
  });
});

/** Every line the real logger writes since the case began, read off standard output. */
const log = captureLog();

/** The events of the lines written at `level` since the case began, or since the line `from` counts. */
const eventsAt = (level: "WARNING" | "ERROR", from = 0): string[] =>
  log
    .lines()
    .slice(from)
    .flatMap((line) => (line.level === level ? [line.message] : []));
const barrier = new Barrier();

/** Where each bound's count waits, for a case that arms it. */
const counting = new Barrier();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth, codeMailCapped } = await import("./auth/library");
const { carryAccount, deleteAccountFor, deleteOwnAccount, requestAccountDeletion } = await import("./auth/accounts");
const { endOtherSessions, endSessionsOfAddress } = await import("./auth/accountSessions");
const { getAccountSession } = await import("./auth/guards");
const authIndexes = await import("./authIndexes");
const { MONGO_DB_NAME } = authIndexes;

const realClient = productionClient as MongoClient;
closing(() => realClient.close());
const authDb = () => realClient.db(MONGO_DB_NAME);

signInIndexesForTheFile(authIndexes, mongod);

beforeEach(async () => {
  gateAnswer = { seats: [], barred: false, account: false };
  requestHeaders = undefined;
  barrier.disarm();
  counting.disarm();
  atCommit = async () => undefined;
  deletingAccounts = async () => undefined;
  deletingUser = async () => undefined;
  await emptyStore(authDb());
});

const handler = toNextJsHandler(auth);

async function overHttp(path: string, { method = "GET", cookie, body }: { method?: "GET" | "POST"; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { ...ORIGIN, origin: "http://localhost:3000" };
  if (cookie !== undefined) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const request = new Request(`http://localhost:3000/api/auth${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return method === "GET" ? handler.GET(request) : handler.POST(request);
}

/** A code-borne session, minted the way a typed code mints one. */
async function signIn(email: string): Promise<string> {
  return cookieHeader(await signInByCode(auth, email));
}

type Offered = { cookie: string; challenge: string };

/** The options half, run to completion: what the verify half then needs to be posted. */
async function offer(cookie: string): Promise<Offered> {
  const offered = await overHttp("/passkey/generate-register-options", { cookie });
  expect(offered.status, await offered.clone().text()).toBe(200);
  const { challenge } = (await offered.json()) as { challenge: string };
  return { cookie: `${cookie}; ${cookieHeader(offered)}`, challenge };
}

function verify(offered: Offered, rawId: Buffer, extra: Record<string, unknown> = {}): Promise<Response> {
  return overHttp("/passkey/verify-registration", {
    method: "POST",
    cookie: offered.cookie,
    body: { response: registrationFor(offered.challenge, true, rawId), ...extra },
  });
}

async function sessionRows(): Promise<Record<string, unknown>[]> {
  return authDb().collection("session").find({}).toArray();
}

async function passkeyRows(): Promise<Record<string, unknown>[]> {
  return authDb().collection("passkey").find({}).toArray();
}

const AUTHENTICATOR_A = Buffer.from("fl-auth-db-authenticator-a");

/* The session a setup mints is written inside the transaction the plugin opens around a registration
   that signs in, so a setup the database refuses signs nobody in and nobody out. */
describe("a passkey setup that signs in, against a real database", () => {
  /* One authenticator twice: both pass the hook, the loser's insert conflicts inside its transaction, and the run the
     adapter retries meets the winner's row in the unique index on the credential, a duplicate no retry clears. */
  it("mints one session for the winner of two setups at once, and refuses the loser on the index, leaving it signed in by code", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));
    const mailedBefore = sent.length;

    barrier.arm(2);
    const responses = await Promise.all([
      verify(a, AUTHENTICATOR_A, { createSession: true }),
      verify(b, AUTHENTICATOR_A, { createSession: true }),
    ]);
    barrier.disarm();
    assert.ok(await barrier.filled, "the setups were not both held at their first write, so no race was run");

    expect(responses.map((response) => response.status).sort()).toStrictEqual([200, 500]);
    expect([eventsAt("WARNING"), eventsAt("ERROR")]).toStrictEqual([["auth.passkey_enrolment_conflict"], []]);
    expect(sent.length - mailedBefore).toBe(1);
    const factors = (await sessionRows()).map(({ authFactor }) => authFactor).sort();
    expect(factors, "the refused setup minted a session or ended its caller's").toStrictEqual(["code", "passkey"]);
  });

  /* The enrolment guard reads the caller's own rows alone, so a credential another account holds reaches
     the insert, where the index refuses it as a duplicate no retry clears. */
  it("refuses a setup naming a credential another account holds as the plugin's failure, on the conflict's warning", async () => {
    const administrator = await offer(await signIn(ADMIN_EMAIL));
    expect((await verify(administrator, AUTHENTICATOR_A)).status, "the administrator holds no passkey, so nothing is named twice").toBe(200);
    const other = await offer(await signIn(SECOND_ADMIN_EMAIL));
    // The administrator's own enrolment above is not the conflict read below.
    const warnedFrom = log.lines().length;
    const mailedBefore = sent.length;

    const refused = await verify(other, AUTHENTICATOR_A, { createSession: true });

    expect({
      status: refused.status,
      logged: [eventsAt("WARNING", warnedFrom), eventsAt("ERROR")],
      notices: sent.length - mailedBefore,
      rows: (await passkeyRows()).length,
      factors: (await sessionRows()).map(({ authFactor }) => authFactor),
    }).toStrictEqual({ status: 500, logged: [["auth.passkey_enrolment_conflict"], []], notices: 0, rows: 1, factors: ["code", "code"] });
  });
});

describe("what a ban ends, against a real database", () => {
  it("deletes every session of the account at the folded address, and keeps the account", async () => {
    const { adapter } = await auth.$context;
    const person = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "user",
      data: { email: "leser@xn--bcher-kva.example", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() },
    });
    const other = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "user",
      data: { email: "unbeteiligt@example.org", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() },
    });
    const session = (userId: string) => ({
      userId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      authFactor: "code",
    });
    for (const userId of [person.id, person.id, other.id]) await adapter.create({ model: "session", data: session(userId) });

    await endSessionsOfAddress("Leser@XN--BCHER-KVA.example");

    expect(
      (await sessionRows()).map(({ userId }) => String(userId)),
      "a session of the barred account survived, or another account's was ended",
    ).toStrictEqual([other.id]);
    expect((await authDb().collection("user").find({}).toArray()).length).toBe(2);
  });
});

describe("ending every other session, against a real database", () => {
  /** A person rather than an administrator, whose sessions by a mailed code the account page serves. */
  const PERSON = "person@example.org";

  /* Every other suite stands in for `endOtherSessions`: the adapter's conversion of both ids is met here alone. */
  it("ends every other session and keeps its own", async () => {
    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const kept = await signIn(PERSON);
    requestHeaders = new Headers({ ...ORIGIN, cookie: kept });
    await signIn(PERSON);
    await signIn(PERSON);
    const served = await getAccountSession();
    assert.ok(served, "the account page refused the session");
    const sessions = authDb().collection("session");
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

describe("an address change carrying the account, against a real database", () => {
  /** An account at `email` holding two sessions and one passkey. */
  async function accountAt(email: string): Promise<string> {
    const { adapter } = await auth.$context;
    const account = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "user",
      data: { email, emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() },
    });
    for (let index = 0; index < 2; index++) {
      await adapter.create({
        model: "session",
        data: {
          userId: account.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          authFactor: "code",
        },
      });
    }
    await adapter.create({
      model: "passkey",
      data: {
        userId: account.id,
        credentialID: `kept-${email}`,
        publicKey: "k",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "",
        createdAt: new Date(),
      },
    });
    return account.id;
  }

  const accounts = async (): Promise<[string, string][]> =>
    (await authDb().collection("user").find({}).toArray()).map(({ _id, email }) => [String(_id), String(email)] as [string, string]).sort();

  it("moves the account and its passkeys to the folded new address and deletes every session of it", async () => {
    const person = await accountAt("alt@schule.example");
    const other = await accountAt("unbeteiligt@example.org");

    expect(await carryAccount("Alt@Schule.example", "Neu@XN--BCHER-KVA.example")).toBe("moved");

    expect(await accounts()).toStrictEqual(
      [
        [person, "neu@xn--bcher-kva.example"],
        [other, "unbeteiligt@example.org"],
      ].sort(),
    );
    expect(
      [...new Set((await sessionRows()).map(({ userId }) => String(userId)))],
      "a session of the carried account survived, or another account's was ended",
    ).toStrictEqual([other]);
    expect((await passkeyRows()).filter(({ userId }) => String(userId) === person).length).toBe(1);
  });

  // The unique index refuses the move, and the stamp rides that refused write: nothing of either account changes.
  it("answers taken and moves nothing where the new address holds an account of its own", async () => {
    const person = await accountAt("alt@schule.example");
    const holder = await accountAt("neu@schule.example");

    expect(await carryAccount("alt@schule.example", "neu@schule.example")).toBe("taken");

    expect(await accounts()).toStrictEqual(
      [
        [person, "alt@schule.example"],
        [holder, "neu@schule.example"],
      ].sort(),
    );
    expect((await sessionRows()).length, "a session was ended by a carry that moved nothing").toBe(4);
    // Each account keeps exactly its own: a passkey handed to the holder's account would let one person sign in to the other's.
    expect(
      (await passkeyRows()).map(({ userId, credentialID }) => [String(userId), String(credentialID)]).sort(),
      "a carry that moved nothing moved a passkey",
    ).toStrictEqual(
      [
        [person, "kept-alt@schule.example"],
        [holder, "kept-neu@schule.example"],
      ].sort(),
    );
    // A stamp written apart from the refused move would end every session of a person whose address never changed.
    expect(
      (
        await authDb()
          .collection("user")
          .find({ sessionsEndedAt: { $exists: true } })
          .toArray()
      ).length,
      "a carry that moved nothing stamped an account's sessions ended",
    ).toStrictEqual(0);
  });
});

/* The Mongo adapter turns the holders' `in` on `id` and the deletion's `userId` into ObjectId queries of its own, which
   the memory store never shows: a query matching nothing would leave every stray passkey signing in, the sweep's count
   saying it found none. */
describe("the account sweep's passkey step, against a real database", () => {
  /** An account at `email`, holding a passkey where `passkey` is set, signed in by it and by a code. */
  async function accountAt(email: string, passkey: boolean): Promise<void> {
    const { adapter } = await auth.$context;
    const account = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "user",
      data: { email, emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() },
    });
    if (passkey) {
      await adapter.create({
        model: "passkey",
        data: {
          userId: account.id,
          credentialID: `credential-${email}`,
          publicKey: "k",
          counter: 0,
          deviceType: "singleDevice",
          backedUp: false,
          transports: "",
          createdAt: new Date(),
        },
      });
    }
    for (const authFactor of ["passkey", "code"]) {
      await adapter.create({
        model: "session",
        data: {
          userId: account.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
          authFactor,
        },
      });
    }
  }

  it("lists each passkey holder's address, and deletes one's passkeys and passkey sessions alone", async () => {
    const { deletePasskeysAt, passkeyHolders } = await import("./auth/passkeys");
    await accountAt("ehemalig-db@example.org", true);
    await accountAt("verwaltung-db@example.org", true);
    await accountAt("ohne-passkey-db@example.org", false);

    expect((await passkeyHolders()).sort()).toStrictEqual(["ehemalig-db@example.org", "verwaltung-db@example.org"]);

    await deletePasskeysAt("ehemalig-db@example.org");

    expect(await passkeyHolders()).toStrictEqual(["verwaltung-db@example.org"]);
    const addressOf = new Map((await authDb().collection("user").find({}).toArray()).map(({ _id, email }) => [String(_id), String(email)]));
    expect(
      (await sessionRows()).map(({ userId, authFactor }) => [addressOf.get(String(userId)), authFactor]).sort(),
      "the deletion missed a passkey session, or took a code session or another account's",
    ).toStrictEqual(
      [
        ["ehemalig-db@example.org", "code"],
        ["verwaltung-db@example.org", "passkey"],
        ["verwaltung-db@example.org", "code"],
        ["ohne-passkey-db@example.org", "passkey"],
        ["ohne-passkey-db@example.org", "code"],
      ].sort(),
    );
  });
});

describe("an address's failures, against a real database", () => {
  async function failureRows(): Promise<Record<string, unknown>[]> {
    return authDb()
      .collection("verification")
      .find({ identifier: { $regex: "^sign-in-attempt-" } })
      .toArray();
  }

  /* Each attempt's row goes in before it counts; held at the count until the whole burst has arrived,
     every count sees every row, the worst interleaving a real store can give. */
  it("lets no burst of concurrent wrong codes past the bound", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    const wrong = otp === "000000" ? "111111" : "000000";

    counting.arm(15);
    const answers = await Promise.all(
      Array.from({ length: 15 }, () =>
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: wrong }, headers: new Headers(ORIGIN) }).then(
          () => "signed in",
          (error: { body?: { code?: unknown } }) => error.body?.code,
        ),
      ),
    );
    assert.ok(await counting.filled, "the burst never met at the count, so it ran no race");

    const reached = answers.filter((answer) => answer !== "ADDRESS_ATTEMPTS_EXHAUSTED").length;
    assert.ok(reached <= 10, `${String(reached)} of 15 concurrent attempts reached the code`);
    assert.ok((await failureRows()).length <= 10);
  });
});

/* The typed code's own path through the mint: its creation hook stamps the factor and asks the gate,
   and the rotation ends the session the browser held. */
describe("a code sign-in through the mint, against a real database", () => {
  const PERSON = "spielerin-mit-code@example.org";

  it("stamps the session it mints `code`, and ends the one the browser held", async () => {
    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const held = await signIn(PERSON);
    const [before] = await sessionRows();
    assert.ok(before !== undefined, "the first code sign-in minted nothing, so nothing below is replaced");

    await signInByCode(auth, PERSON, { ...ORIGIN, cookie: held });

    const after = await sessionRows();
    expect(
      after.map(({ authFactor }) => authFactor),
      "the replaced session outlived the new one, or the new one was never written",
    ).toStrictEqual(["code"]);
    expect(after[0]?.token).not.toBe(before.token);
  });

  /* The sibling read and delete run on the real adapter's id and reference types, which the memory
     store's plain strings never test. */
  it("leaves only the later of two sessions minted to replace one cookie", async () => {
    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const held = await signIn(PERSON);

    const earlier = cookieHeader(await signInByCode(auth, PERSON, { ...ORIGIN, cookie: held }));
    const later = cookieHeader(await signInByCode(auth, PERSON, { ...ORIGIN, cookie: held }));

    const opens = async (cookie: string) => (await auth.api.getSession({ headers: new Headers({ ...ORIGIN, cookie }) })) !== null;
    expect(
      { rows: (await sessionRows()).length, open: [await opens(earlier), await opens(later)] },
      "the earlier replacement outlived the later one, held by no cookie",
    ).toStrictEqual({ rows: 1, open: [false, true] });
  });
});

/* The slide's write is the Mongo adapter's update by token, which the memory store's plain objects
   never test: an update matching nothing signs the reader out instead. */
describe("a session only read, against a real database", () => {
  it("slides the stored row once past `updateAge` at the proxy, and never at a guard's read", async () => {
    const { readServedSession } = await import("./auth/session");
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");

    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const cookie = await signIn("leserin-mit-code@example.org");
    const expiresIn = auth.options.session.expiresIn * 1000;
    const updatedAt = new Date(Date.now() - auth.options.session.updateAge * 1000 - 60_000);
    await authDb()
      .collection("session")
      .updateMany({}, { $set: { updatedAt, expiresAt: new Date(updatedAt.getTime() + expiresIn) } });
    const stamps = async () => (await sessionRows()).map((row) => [(row.updatedAt as Date).getTime(), (row.expiresAt as Date).getTime()]);
    const due = await stamps();

    assert.ok(await readServedSession(new Headers({ ...ORIGIN, cookie })), "the guard read no session, so the case proves nothing");
    expect(await stamps(), "a guard's read wrote the row").toStrictEqual(due);

    const before = Date.now();
    await proxy(new NextRequest("http://localhost:3000/account", { headers: { ...ORIGIN, cookie } }));

    const [[slidAt = 0, lapsesAt = 0] = []] = await stamps();
    assert.ok(slidAt >= before && lapsesAt >= before + expiresIn, "the proxy's read left the stored row where it was");
  });
});

/**
 * One signed-in address with every row the store keeps of it: a session, a live code, a failed guess, three mails'
 * counts, a deletion token, and a passkey, which only an administrator's account holds and every deletion of an
 * account takes with it.
 */
async function seedAccount(email: string): Promise<{ cookie: string; userId: string; pending: string[]; token: string }> {
  gateAnswer = { seats: [SEAT], barred: false, account: true };
  const cookie = await signIn(email);
  const account = await authDb().collection("user").find({ email }).toArray();
  const userId = String(account[0]?._id ?? assert.fail("the sign-in wrote no account"));
  const before = new Set((await authDb().collection("verification").find({}).toArray()).map((row) => String(row._id)));

  const headers = new Headers(ORIGIN);
  // Counted, then sent, as the sign-in action asks for a code.
  expect(await codeMailCapped(email)).toBe(false);
  await auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers });
  const otp = lastMailedCode(sent, email);
  assert.ok(otp !== null, "the send mailed no code");
  await expect(auth.api.signInEmailOTP({ body: { email, otp: otp === "000000" ? "111111" : "000000" }, headers })).rejects.toThrow();
  const { adapter } = await auth.$context;
  await adapter.create({
    model: "passkey",
    data: {
      userId,
      credentialID: `credential-${email}`,
      publicKey: "k",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "",
      createdAt: new Date(),
    },
  });
  await requestAccountDeletion(new Headers({ ...ORIGIN, cookie }));
  const found = /\/erasure\?token=([0-9a-z]+)/.exec([...sent].reverse().find((message) => message.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the request mailed no link to the interstitial");
  await requestAccountDeletion(new Headers({ ...ORIGIN, cookie }));

  const pending = (await authDb().collection("verification").find({}).toArray())
    .filter((row) => !before.has(String(row._id)))
    .map((row) => String(row.identifier));
  expect(pending.length, `the seeding left ${String(pending.length)} pending rows, so a case reads fewer than it means to`).toBe(7);

  return { cookie, userId, pending, token: found[1] };
}

/** What the store still holds of a seeded account, by kind. */
async function heldOf({ userId, pending }: { userId: string; pending: readonly string[] }) {
  const of = async (name: string, filter: object) => (await authDb().collection(name).find(filter).toArray()).length;
  return {
    user: await of("user", { _id: new ObjectId(userId) }),
    sessions: await of("session", { userId: new ObjectId(userId) }),
    passkeys: await of("passkey", { userId: new ObjectId(userId) }),
    pending: await of("verification", { identifier: { $in: pending } }),
  };
}

/* The Mongo adapter turns the helper's `in` and `starts_with` into a query of its own, which the memory store
   never shows: a row they miss stands here and nowhere else. */
describe("an account deleted, against a real database", () => {
  it("leaves nothing of the address once its own link completes, and nothing of anybody else's goes", async () => {
    const { runWithRequestScope, setRequestActor } = await import("./requestScope");
    const bystander = await seedAccount("unbeteiligt-db@example.org");
    const person = await seedAccount("loeschende-db@example.org");
    const erasuresBefore = erasuresAsked;

    const answer = await runWithRequestScope({ traceId: `${"0".repeat(31)}4` }, () => {
      setRequestActor({ email: "loeschende-db@example.org", lane: "person", authTime: 0, factor: "code" });
      return deleteOwnAccount(person.token, new Headers({ ...ORIGIN, cookie: person.cookie }));
    });

    expect([answer, erasuresAsked - erasuresBefore]).toStrictEqual(["deleted", 1]);
    expect(await heldOf(person)).toStrictEqual({ user: 0, sessions: 0, passkeys: 0, pending: 0 });
    expect(await heldOf(bystander)).toStrictEqual({ user: 1, sessions: 1, passkeys: 1, pending: 7 });
  });

  /* Both deletion paths find an account by its user row, so the helper goes first: a failure at that row
     leaves it for them to find, and no passkey past their reach. */
  it("leaves the user row alone where the library's delete of it fails, its passkeys and pending rows gone", async () => {
    const { runWithRequestScope, setRequestActor } = await import("./requestScope");
    const person = await seedAccount("nutzerzeile-db@example.org");
    deletingUser = () => Promise.reject(new Error("planted: the user row's delete fails"));

    await expect(
      runWithRequestScope({ traceId: `${"0".repeat(31)}5` }, () => {
        setRequestActor({ email: "nutzerzeile-db@example.org", lane: "person", authTime: 0, factor: "code" });
        return deleteOwnAccount(person.token, new Headers({ ...ORIGIN, cookie: person.cookie }));
      }),
      // Past the library's spend of the link, so of an outcome the press cannot name, the planted failure its cause.
    ).rejects.toSatisfy(
      (thrown: Error) =>
        thrown.name === "DeletionOutcomeUnknown" && /planted: the user row's delete fails/.test((thrown.cause as Error).message),
    );

    expect(await heldOf(person)).toStrictEqual({ user: 1, sessions: 0, passkeys: 0, pending: 0 });
  });

  it("deletes every row of an address in one transaction for the administrator's erasure and the sweep", async () => {
    const bystander = await seedAccount("unbeteiligt-konto-db@example.org");
    const person = await seedAccount("konto-weg-db@example.org");

    expect(await deleteAccountFor("Konto-Weg-DB@Example.org")).toBe(true);

    expect(await heldOf(person)).toStrictEqual({ user: 0, sessions: 0, passkeys: 0, pending: 0 });
    expect(await heldOf(bystander)).toStrictEqual({ user: 1, sessions: 1, passkeys: 1, pending: 7 });
  });

  /* The first run's commit fails transiently and writes nothing, so the adapter runs the deletion again; that
     run fails before its commit, and the caller is told of the rollback it is rather than an unknown outcome. */
  it("answers a rollback where the run retried after a transient commit failure fails, and deletes nothing", async () => {
    const { RolledBackError } = await import("./errors");
    const person = await seedAccount("konto-zweiter-lauf-db@example.org");
    let commits = 0;
    atCommit = async (session) => {
      commits += 1;
      if (commits > 1) return;
      // The server's answer to a commit whose transaction it already dropped, as across a failover.
      // Built rather than raised by the server: the test container refuses `configureFailPoint`.
      await session.abortTransaction();
      throw new MongoServerError({
        message: "planted: the transaction was gone at its commit",
        code: 251,
        codeName: "NoSuchTransaction",
        errorLabels: ["TransientTransactionError"],
      });
    };
    let runs = 0;
    deletingAccounts = async () => {
      runs += 1;
      if (runs > 1) throw new Error("planted: the retried run fails");
    };

    const answer = await deleteAccountFor("konto-zweiter-lauf-db@example.org").catch((failed: unknown) => failed);

    expect(runs, "the adapter ran the deletion once, so no retry followed a commit").toBe(2);
    assert.ok(answer instanceof RolledBackError, `the caller was told ${String(answer)} rather than of a rollback`);
    expect(await heldOf(person)).toStrictEqual({ user: 1, sessions: 1, passkeys: 1, pending: 7 });
  });
});
