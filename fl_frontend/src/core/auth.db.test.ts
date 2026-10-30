import { randomUUID } from "node:crypto";

import {
  ADMIN_EMAIL,
  Barrier,
  BARRIER_TIMEOUT_MS,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  HOLDS_NOTHING,
  lastMailedCode,
  ORIGIN,
  overriding,
  registerAuthDoubles,
  signInByCode,
} from "@/test-support/authDoubles.ts";
import { replicaSetUrl, startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { answerAt, SEAT } from "@/test-support/subjectFixtures.ts";
import { registrationFor } from "@/test-support/testAuthenticator.ts";
import { MongoServerError } from "mongodb";
import { afterAll, assert, beforeEach, describe, expect, it } from "vitest";

import type { LookupFixture } from "@/test-support/subjectFixtures.ts";

// A replica set.
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
      if (name === "verification" && prop === "findOneAndDelete") {
        return async (...args: unknown[]) => {
          await consuming();
          return (value as Method).apply(target, args);
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

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => void warnings.push(message),
    error: (message: string) => void errors.push(message),
  },
};

const { sent } = registerAuthDoubles({
  core: { config: configDouble(GATE_BACKEND_CONFIG, { mongodbUri: () => MONGO_URL }), db: DB_DOUBLE, logging: LOGGING_DOUBLE },
});

/** What the sign-in gate's backend read answers every address; a case sets it and `beforeEach` resets it. */
let gateAnswer: Pick<LookupFixture, "seats" | "barred" | "account"> = { seats: [], barred: false, account: false };

// The backend's origin alone: every other request, the container runtime's among them, goes out as it came.
const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(GATE_BACKEND_CONFIG.API_URL)) return ORIGINAL_FETCH(input, init);

  // The grant is what makes `ADMIN_EMAIL` an administrator's; every other address holds none.
  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  const granted = email === ADMIN_EMAIL;
  const body = answerAt(new URL(url).pathname, {
    ...HOLDS_NOTHING,
    verwaltung: granted ? "administration" : null,
    // Before every session a case makes.
    granted_since: granted ? "2026-01-01T00:00:00Z" : null,
    ...gateAnswer,
  });
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}) as typeof globalThis.fetch;

/**
 * Holds the one write that arrives first until `release`, and passes every later one: the order in
 * which one request commits whole while the other, already judged, waits at its first write.
 */
class Gate {
  private release_: () => void = () => undefined;
  private reachedResolve: () => void = () => undefined;
  private armed = true;

  /**
   * Whether a write arrived and is being held. Bounded as the barrier's wait is, so a request that
   * never reaches a held write answers `false` rather than hanging the run.
   */
  readonly reached = new Promise<boolean>((resolve) => {
    this.reachedResolve = () => resolve(true);
    setTimeout(() => resolve(false), BARRIER_TIMEOUT_MS).unref();
  });

  async arrive(): Promise<void> {
    if (!this.armed) return;
    this.armed = false;
    this.reachedResolve();
    await new Promise<void>((resolve) => {
      this.release_ = resolve;
      setTimeout(resolve, BARRIER_TIMEOUT_MS);
    });
  }

  release(): void {
    this.release_();
  }
}

const warnings: string[] = [];
const errors: string[] = [];
const barrier = new Barrier();

/** Where each bound's count waits, for a case that arms it. */
const counting = new Barrier();

/**
 * What runs as a verification row is consumed: a passkey's challenge after its session was read and
 * before its transaction, a code inside its consume's own transaction.
 */
let consuming: () => Promise<unknown> = async () => undefined;

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth, carryAccount, deleteAccountFor, deleteOwnAccount, endSessionsOfAddress, requestAccountDeletion } = await import("./auth.ts");
const { buildAuthIndexes } = await import("./authIndexes.ts");

type Collection = {
  find: (filter: object) => { toArray: () => Promise<Record<string, unknown>[]> };
  updateMany: (filter: object, update: object) => Promise<unknown>;
  deleteMany: (filter: object) => Promise<unknown>;
};
type RealClient = {
  db: (name: string) => { dropDatabase: () => Promise<unknown>; collection: (name: string) => Collection };
  close: () => Promise<void>;
};

const realClient = productionClient as RealClient;
closing(() => realClient.close());
const authDb = () => realClient.db("auth");

afterAll(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

beforeEach(async () => {
  gateAnswer = { seats: [], barred: false, account: false };
  barrier.disarm();
  counting.disarm();
  warnings.length = 0;
  consuming = async () => undefined;
  atCommit = async () => undefined;
  deletingAccounts = async () => undefined;
  deletingUser = async () => undefined;
  await authDb().dropDatabase();

  // Production's indexes under every case, so the library is driven over what it meets there.
  errors.length = 0;
  await buildAuthIndexes();
  expect(errors, "an index of the sign-in store was left unbuilt").toStrictEqual([]);
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

/** Two verify halves, both held at their first write until both have been judged. */
async function atOnce(
  pairs: readonly (readonly [Offered, Buffer])[],
): Promise<{ statuses: number[]; codes: unknown[]; notices: number; warnings: string[] }> {
  const mailedBefore = sent.length;
  barrier.arm(pairs.length);
  const responses = await Promise.all(pairs.map(([offered, rawId]) => verify(offered, rawId)));
  barrier.disarm();
  assert.ok(await barrier.filled, "the enrolments were not all held at `passkey.insertOne`, so no race was run");

  const refused = responses.filter((response) => response.status !== 200);
  const codes = await Promise.all(refused.map(async (response) => ((await response.json()) as { code?: unknown }).code));
  return { statuses: responses.map((response) => response.status).sort(), codes, notices: sent.length - mailedBefore, warnings: [...warnings] };
}

const AUTHENTICATOR_A = Buffer.from("fl-auth-db-authenticator-a");
const AUTHENTICATOR_B = Buffer.from("fl-auth-db-authenticator-b");

describe("two enrolments of one administrator, against a real database", () => {
  // The clause holds in sequence; two enrolments at once may both stand.
  it("refuses a second code-borne enrolment made after the first", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const first = await verify(a, AUTHENTICATOR_A);
    const second = await verify(b, AUTHENTICATOR_B);

    expect([first.status, second.status, (await passkeyRows()).length]).toStrictEqual([200, 404, 1]);
  });

  // The credential index alone keeps one row here, and answers the loser with the plugin's own failure
  // rather than a refusal the dialog can word.
  it("stores one authenticator enrolled twice at once as one row", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const raced = await atOnce([
      [a, AUTHENTICATOR_A],
      [b, AUTHENTICATOR_A],
    ]);

    expect({ ...raced, rows: (await passkeyRows()).length, errors: [...errors] }).toStrictEqual({
      statuses: [200, 500],
      codes: ["FAILED_TO_VERIFY_REGISTRATION"],
      notices: 1,
      warnings: ["auth.passkey_enrolment_conflict"],
      rows: 1,
      errors: [],
    });
  });
});

/* The session a setup mints is written inside the transaction the plugin opens around a registration
   that signs in, so a setup the database refuses signs nobody in and nobody out. */
describe("a passkey setup that signs in, against a real database", () => {
  it("replaces the code's session with the passkey's, the credential stamped", async () => {
    const offered = await offer(await signIn(ADMIN_EMAIL));

    const enrolled = await verify(offered, AUTHENTICATOR_A, { createSession: true });
    expect(enrolled.status, await enrolled.clone().text()).toBe(200);

    const sessions = await sessionRows();
    expect(
      sessions.map(({ authFactor, passkeyCredentialId }) => [authFactor, passkeyCredentialId]),
      "the code's session outlived the setup, or the passkey's was never written",
    ).toStrictEqual([["passkey", AUTHENTICATOR_A.toString("base64url")]]);
  });

  /* One authenticator twice: the loser's insert conflicts inside its transaction, and the run the
     adapter retries meets the winner's row in the enrolment guard, whose refusal is a 404 and no line. */
  it("mints one session for the winner of two setups at once, and refuses the loser, leaving it signed in by code", async () => {
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

    expect(responses.map((response) => response.status).sort()).toStrictEqual([200, 404]);
    expect([warnings, errors]).toStrictEqual([[], []]);
    expect(sent.length - mailedBefore).toBe(1);
    const factors = (await sessionRows()).map(({ authFactor }) => authFactor).sort();
    expect(factors, "the refused setup minted a session or ended its caller's").toStrictEqual(["code", "passkey"]);
  });

  /* The enrolment guard reads the caller's own rows alone, so a credential another account holds reaches
     the insert, where the index refuses it as a duplicate no retry clears. */
  it("refuses a setup naming a credential another account holds as the plugin's failure, on the conflict's warning", async () => {
    const administrator = await offer(await signIn(ADMIN_EMAIL));
    expect((await verify(administrator, AUTHENTICATOR_A)).status, "the administrator holds no passkey, so nothing is named twice").toBe(200);
    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const person = await offer(await signIn("zweites-konto@example.org"));
    warnings.length = 0;
    const mailedBefore = sent.length;

    const refused = await verify(person, AUTHENTICATOR_A, { createSession: true });

    expect({
      status: refused.status,
      logged: [warnings, errors],
      notices: sent.length - mailedBefore,
      rows: (await passkeyRows()).length,
      factors: (await sessionRows()).map(({ authFactor }) => authFactor),
    }).toStrictEqual({ status: 500, logged: [["auth.passkey_enrolment_conflict"], []], notices: 0, rows: 1, factors: ["code", "code"] });
  });
});

describe("what a ban ends, against a real database", () => {
  it("deletes every session of the account at the folded address, and keeps the account and its passkeys", async () => {
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
      userId: userId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      authFactor: "code",
    });
    for (const userId of [person.id, person.id, other.id]) await adapter.create({ model: "session", data: session(userId) });
    await adapter.create({
      model: "passkey",
      data: {
        userId: person.id,
        credentialID: "kept",
        publicKey: "k",
        counter: 0,
        deviceType: "singleDevice",
        backedUp: false,
        transports: "",
        createdAt: new Date(),
      },
    });

    await endSessionsOfAddress("Leser@Bücher.example");

    expect(
      (await sessionRows()).map(({ userId }) => String(userId)),
      "a session of the barred account survived, or another account's was ended",
    ).toStrictEqual([other.id]);
    expect((await authDb().collection("user").find({}).toArray()).length).toBe(2);
    expect((await passkeyRows()).length).toBe(1);
  });
});

describe("an address change carrying the account, against a real database", () => {
  /** An account at `email` holding two sessions and one passkey. */
  async function accountAt(email: string): Promise<string> {
    const { adapter } = await auth.$context;
    const account = await adapter.create<Record<string, unknown>, { id: string }>({
      model: "user",
      data: { email: email, emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() },
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

    expect(await carryAccount("Alt@Schule.example", "Neu@Bücher.example")).toBe("umgezogen");

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
  it("answers „belegt“ and moves nothing where the new address holds an account of its own", async () => {
    const person = await accountAt("alt@schule.example");
    const holder = await accountAt("neu@schule.example");

    expect(await carryAccount("alt@schule.example", "neu@schule.example")).toBe("belegt");

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

/* The memory adapter's `delete` removes every row it matches and MongoDB's removes one, so the
   clearing is judged here and nowhere else. */
describe("an address's failures after a code signs in, against a real database", () => {
  async function failureRows(): Promise<Record<string, unknown>[]> {
    return authDb()
      .collection("verification")
      .find({ identifier: { $regex: "^sign-in-attempt-" } })
      .toArray();
  }

  it("clears every failure the address had, not one of them", async () => {
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    const wrong = otp === "000000" ? "111111" : "000000";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: wrong }, headers: new Headers(ORIGIN) })).rejects.toSatisfy(
        (error: { body?: { code?: unknown } }) => error.body?.code === "INVALID_OTP",
      );
    }
    expect((await failureRows()).length, "the failures were not counted, so the clearing below proves nothing").toBe(2);

    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN) });

    expect(await failureRows(), "a sign-in left failures standing against the address").toStrictEqual([]);
  });

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

  /* A refusal at the mint comes after the code verified, so it is no guess: its row comes back out on
     the real store as on the memory one. */
  it("counts no refusal at the mint, and still counts a wrong code", async () => {
    const email = "gesperrt-mit-code@example.org";
    gateAnswer = { seats: [SEAT], barred: true, account: true };
    const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });

    await expect(auth.api.signInEmailOTP({ body: { email, otp }, headers: new Headers(ORIGIN) })).rejects.toSatisfy(
      (error: { body?: { code?: unknown } }) => error.body?.code === "SIGN_IN_BARRED",
    );
    expect(await failureRows(), "the refusal at the mint was counted as a failed code").toStrictEqual([]);

    const next = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: next === "000000" ? "111111" : "000000" }, headers: new Headers(ORIGIN) }),
    ).rejects.toSatisfy((error: { body?: { code?: unknown } }) => error.body?.code === "INVALID_OTP");
    expect((await failureRows()).length).toBe(1);
  });
});

/* A wrong guess consumes the code and writes it back after its check. A send from another request,
   inside the consume's transaction, writes a newer code the written-back one must not outrank. */
describe("a wrong code racing a new one's send, against a real database", () => {
  it("signs in with the code mailed while a wrong guess was being checked", async () => {
    const headers = new Headers(ORIGIN);
    await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers });
    const stale = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(stale !== null, "the first send mailed nothing, so no code is raced");

    const gate = new Gate();
    consuming = () => gate.arrive();
    const guess = auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: stale === "000000" ? "111111" : "000000" }, headers }).then(
      () => "signed in",
      (error: { body?: { code?: unknown } }) => error.body?.code,
    );
    try {
      assert.ok(await gate.reached, "the wrong guess never reached its consume, so no race was run");
      // From this request and never from inside the held one, whose transaction a nested call would join.
      await auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers });
    } finally {
      gate.release();
    }
    expect(await guess).toBe("INVALID_OTP");

    const fresh = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(fresh !== null && fresh !== stale, "the racing send mailed no new code");
    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: fresh }, headers });

    expect((await sessionRows()).length).toBe(1);
  });
});

/* The per-address mail cap's own race, on the real store: sends held at their count until the whole
   burst has arrived. */
describe("the code mails one address may be sent, against a real database", () => {
  it("mails no burst of concurrent sends past the fifth", async () => {
    const before = sent.length;

    counting.arm(8);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers: new Headers(ORIGIN) }),
      ),
    );
    assert.ok(await counting.filled, "the burst never met at the count, so it ran no race");

    assert.ok(sent.length - before <= 5, `${String(sent.length - before)} of 8 concurrent sends were mailed`);
  });
});

/* The set-up that signs in mints inside the registration's transaction, so the gate refusing that mint
   takes the passkey row back with it; the enrolment refuses a barred
   person before any mint. */
describe("a set-up the gate refuses, against a real database", () => {
  it("writes no passkey for a person holding nothing by the set-up, and leaves them signed in by code", async () => {
    const email = "ohne-sitz-spaeter@example.org";

    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const cookie = cookieHeader(await signInByCode(auth, email));
    expect((await sessionRows()).length, "the seated person was not signed in, so the case below proves nothing").toBe(1);

    const offered = await offer(cookie);
    gateAnswer = { seats: [], barred: false, account: false };
    const refused = await verify(offered, AUTHENTICATOR_A, { createSession: true });

    expect(refused.status, await refused.clone().text()).toBe(403);
    expect(((await refused.clone().json()) as { code?: string }).code).toBe("SIGN_IN_HOLDS_NOTHING");
    expect(await passkeyRows(), "the refused set-up left its passkey behind").toStrictEqual([]);
    expect((await sessionRows()).map(({ authFactor }) => authFactor)).toStrictEqual(["code"]);
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

  it("mints nothing for a barred address and ends nothing the browser held", async () => {
    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const held = await signIn(PERSON);
    const before = await sessionRows();

    gateAnswer = { seats: [SEAT], barred: true, account: true };
    await expect(signInByCode(auth, PERSON, { ...ORIGIN, cookie: held })).rejects.toSatisfy((error: { body?: { code?: unknown } }) => {
      return error.body?.code === "SIGN_IN_BARRED";
    });

    expect(await sessionRows(), "a refused code sign-in minted a session or ended the held one").toStrictEqual(before);
  });
});

/* The slide's write is the Mongo adapter's update by token, which the memory store's plain objects
   never test: an update matching nothing signs the reader out instead. */
describe("a session only read, against a real database", () => {
  it("slides the stored row once past `updateAge` at the proxy, and never at a guard's read", async () => {
    const { readServedSession } = await import("./auth.ts");
    const { proxy } = await import("../proxy.ts");
    const { NextRequest } = await import("next/server");

    gateAnswer = { seats: [SEAT], barred: false, account: true };
    const cookie = await signIn("leserin-mit-code@example.org");
    const expiresIn = (auth.options.session?.expiresIn ?? Number.NaN) * 1000;
    const updatedAt = new Date(Date.now() - (auth.options.session?.updateAge ?? Number.NaN) * 1000 - 60_000);
    await authDb()
      .collection("session")
      .updateMany({}, { $set: { updatedAt: updatedAt, expiresAt: new Date(updatedAt.getTime() + expiresIn) } });
    const stamps = async () => (await sessionRows()).map((row) => [(row.updatedAt as Date).getTime(), (row.expiresAt as Date).getTime()]);
    const due = await stamps();

    assert.ok(await readServedSession(new Headers({ ...ORIGIN, cookie })), "the guard read no session, so the case proves nothing");
    expect(await stamps(), "a guard's read wrote the row").toStrictEqual(due);

    const before = Date.now();
    await proxy(new NextRequest("http://localhost:3000/bereich/konto", { headers: { ...ORIGIN, cookie } }));

    const [[slidAt = 0, lapsesAt = 0] = []] = await stamps();
    assert.ok(slidAt >= before && lapsesAt >= before + expiresIn, "the proxy's read left the stored row where it was");
  });
});

/** One signed-in address with every row the store keeps of it: a session, a passkey, a live code, a failed guess, three mails' counts and a deletion token. */
async function seedAccount(email: string): Promise<{ cookie: string; userId: string; pending: string[]; token: string }> {
  gateAnswer = { seats: [SEAT], barred: false, account: true };
  const cookie = await signIn(email);
  const account = await authDb().collection("user").find({ email }).toArray();
  const userId = String(account[0]?._id ?? assert.fail("the sign-in wrote no account"));
  const before = new Set((await authDb().collection("verification").find({}).toArray()).map((row) => String(row._id)));

  const headers = new Headers(ORIGIN);
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
  const found = /\/loeschung\?token=([0-9a-z]+)/.exec([...sent].reverse().find((message) => message.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the request mailed no link to the interstitial");
  await requestAccountDeletion(new Headers({ ...ORIGIN, cookie }));

  // The aggregate count names no address, so it is nobody's to delete.
  const pending = (await authDb().collection("verification").find({}).toArray())
    .filter((row) => !before.has(String(row._id)) && row.identifier !== "sign-in-mail-every-address")
    .map((row) => String(row.identifier));
  expect(pending.length, `the seeding left ${String(pending.length)} pending rows, so a case reads fewer than it means to`).toBe(7);

  return { cookie, userId, pending, token: found[1] };
}

/** What the store still holds of a seeded account, by kind. */
async function heldOf({ userId, pending }: { userId: string; pending: readonly string[] }) {
  const of = async (name: string, filter: object) => (await authDb().collection(name).find(filter).toArray()).length;
  const { ObjectId } = await import("mongodb");
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
    const { runWithRequestScope } = await import("./requestScope.ts");
    const bystander = await seedAccount("unbeteiligt-db@example.org");
    const person = await seedAccount("loeschende-db@example.org");
    let geloescht = 0;

    const answer = await runWithRequestScope(
      {
        traceId: `${"0".repeat(31)}4`,
        actor: { email: "loeschende-db@example.org", lane: "person", authTime: 0, factor: "code" },
      },
      () =>
        deleteOwnAccount(person.token, new Headers({ ...ORIGIN, cookie: person.cookie }), () => {
          geloescht += 1;
          return Promise.resolve({});
        }),
    );

    expect([answer, geloescht]).toStrictEqual(["deleted", 1]);
    expect(await heldOf(person)).toStrictEqual({ user: 0, sessions: 0, passkeys: 0, pending: 0 });
    expect(await heldOf(bystander)).toStrictEqual({ user: 1, sessions: 1, passkeys: 1, pending: 7 });
  });

  /* Both deletion paths find an account by its user row, so the helper goes first: a failure at that row
     leaves it for them to find, and no passkey past their reach. */
  it("leaves the user row alone where the library's delete of it fails, its passkeys and pending rows gone", async () => {
    const { runWithRequestScope } = await import("./requestScope.ts");
    const person = await seedAccount("nutzerzeile-db@example.org");
    deletingUser = () => Promise.reject(new Error("planted: the user row's delete fails"));

    await expect(
      runWithRequestScope(
        {
          traceId: `${"0".repeat(31)}5`,
          actor: { email: "nutzerzeile-db@example.org", lane: "person", authTime: 0, factor: "code" },
        },
        () => deleteOwnAccount(person.token, new Headers({ ...ORIGIN, cookie: person.cookie }), () => Promise.resolve({})),
      ),
    ).rejects.toThrow(/planted: the user row's delete fails/);

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
    const { RolledBackError } = await import("./errors.ts");
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
