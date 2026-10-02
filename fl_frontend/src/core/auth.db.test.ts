import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";

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
  registerAuthDoubles,
  signInByCode,
} from "./authDoubles.ts";
import { closeJudgingExpiredTransactions, watchExpiredTransactions } from "./expiredTransactions.ts";
import { overridingModule } from "./exportingModule.ts";
import { SITZ } from "./subjectFixtures.ts";
import { registrationFor } from "./testAuthenticator.ts";

// A replica set, which the module starts by default: why this file needs one is
// `docs/frontend/spec.md` §1.9's.
const mongod = await new MongoDBContainer("mongo:8.3.11").start();
await watchExpiredTransactions(mongod);

// The set advertises its container-internal address, which topology discovery would follow and find nothing.
const MONGO_URL = `${mongod.getConnectionString()}/?directConnection=true`;

// A second URL for the production module, which the load hook's match on a path's end lets past the
// double: the client under test is the one `fl_frontend/src/core/db.ts` builds, Stable API included.
const PRODUCTION_DB = `${import.meta.resolve("./db.ts")}?production`;

type Method = (...args: unknown[]) => unknown;

const bound = (target: object, value: unknown): unknown => (typeof value === "function" ? (value as Method).bind(target) : value);

/** The client `fl_frontend/src/core/db.ts` built, which the double below stands over. */
let productionClient: unknown;

/** The first write each collection makes after a request's judgement, held at `holding`. */
const HELD: Readonly<Record<string, string>> = { passkey: "insertOne", user: "findOneAndUpdate" };

const wrapCollection = (name: string, collection: object): object =>
  new Proxy(collection, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (HELD[name] === prop) {
        return async (...args: unknown[]) => {
          await holding.arrive();
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

/* The real client, held where a request makes its first write after its judgement: the passkey row
   where nothing claims the account, the account's own row where something does. */
const DB_DOUBLE = overridingModule(PRODUCTION_DB, {
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

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => void warnings.push(message),
    error: (message: string) => void errors.push(message),
  },
};

const { sent } = registerAuthDoubles({
  core: { config: configDouble({ MONGODB_URI: MONGO_URL, ...GATE_BACKEND_CONFIG }), db: DB_DOUBLE, logging: LOGGING_DOUBLE },
});

/** What the sign-in gate's backend read answers every address; a case sets it and `beforeEach` resets it. */
let gateAnswer: { sitze: unknown[]; gesperrt: boolean } = { sitze: [], gesperrt: false };

// The backend's origin alone: every other request, the container runtime's among them, goes out as it came.
const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(GATE_BACKEND_CONFIG.API_URL)) return ORIGINAL_FETCH(input, init);

  // The grant is what makes `ADMIN_EMAIL` an administrator's; every other address holds none.
  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  const granted = email === ADMIN_EMAIL;
  const body = {
    ...HOLDS_NOTHING,
    verwaltung: granted ? "administration" : null,
    // Before every session a case makes.
    berechtigt_seit: granted ? "2026-01-01T00:00:00Z" : null,
    ...gateAnswer,
  };
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

/** Where a request's first write after its judgement waits: `barrier`, unless a case holds it at its own gate. */
let holding: { arrive: () => Promise<unknown> } = barrier;

/**
 * What runs as a verification row is consumed: a passkey's challenge after its session was read and
 * before its transaction, a code inside its consume's own transaction.
 */
let consuming: () => Promise<unknown> = async () => undefined;

// Imported after the hooks above are registered: a static import resolves before they exist.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth, endSessionsOfAddress, PASSKEY_LIMIT } = await import("./auth.ts");
const { buildAuthIndexes } = await import("./authIndexes.ts");
const { ENROLMENT_CONFLICT } = await import("./passkeyRefusal.ts");

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
const authDb = () => realClient.db("auth");

after(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  await closeJudgingExpiredTransactions(mongod, async () => {
    await realClient.close();
    await mongod.stop();
  });
});

beforeEach(async () => {
  gateAnswer = { sitze: [], gesperrt: false };
  barrier.disarm();
  counting.disarm();
  warnings.length = 0;
  consuming = async () => undefined;
  await authDb().dropDatabase();

  // Production's indexes under every case, so the library is driven over what it meets there.
  errors.length = 0;
  await buildAuthIndexes();
  assert.deepEqual(errors, [], "an index of the sign-in store was left unbuilt");
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
  assert.equal(offered.status, 200, await offered.clone().text());
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
  assert.ok(await barrier.filled, "the enrolments were not all held at `passkey.insertOne` or `user.findOneAndUpdate`, so no race was run");

  const refused = responses.filter((response) => response.status !== 200);
  const codes = await Promise.all(refused.map(async (response) => ((await response.json()) as { code?: unknown }).code));
  return { statuses: responses.map((response) => response.status).sort(), codes, notices: sent.length - mailedBefore, warnings: [...warnings] };
}

const AUTHENTICATOR_A = Buffer.from("fl-auth-db-authenticator-a");
const AUTHENTICATOR_B = Buffer.from("fl-auth-db-authenticator-b");

/** One enrolment stands, the other answers the conflict, one notice is mailed and one line is written. */
const ONE_WINS = { statuses: [200, 409], codes: [ENROLMENT_CONFLICT], notices: 1, warnings: ["auth.passkey_enrolment_conflict"] };

describe("two enrolments of one administrator at once, against a real database (`docs/frontend/spec.md :: I341`)", () => {
  // The clause holding in sequence is what the concurrent cases below are measured against.
  it("refuses a second code-borne enrolment made after the first", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const first = await verify(a, AUTHENTICATOR_A);
    const second = await verify(b, AUTHENTICATOR_B);

    assert.deepEqual([first.status, second.status, (await passkeyRows()).length], [200, 404, 1]);
  });

  // A stolen mailbox racing the administrator's own first enrolment: without the claim both rows
  // stand and neither side is refused.
  it("lets one of two code-borne sessions judged at zero rows enrol", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const raced = await atOnce([
      [a, AUTHENTICATOR_A],
      [b, AUTHENTICATOR_B],
    ]);

    assert.deepEqual({ ...raced, rows: (await passkeyRows()).length }, { ...ONE_WINS, rows: 1 });
  });

  /* The order the barrier above never forces: the second enrolment, judged at zero rows, waits at its
     claim while the first commits whole, so its claim meets that commit's write to the account row. */
  it("refuses the second of two enrolments where the first commits whole before the second claims", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));
    const gate = new Gate();
    holding = gate;

    try {
      const second = verify(b, AUTHENTICATOR_B);
      assert.ok(await gate.reached, "the second enrolment reached neither `passkey.insertOne` nor `user.findOneAndUpdate`");

      const first = await verify(a, AUTHENTICATOR_A);
      gate.release();
      const refused = await second;

      assert.deepEqual(
        {
          statuses: [first.status, refused.status],
          code: ((await refused.json()) as { code?: unknown }).code,
          rows: (await passkeyRows()).length,
          warnings: [...warnings],
        },
        { statuses: [200, 409], code: ENROLMENT_CONFLICT, rows: 1, warnings: ["auth.passkey_enrolment_conflict"] },
      );
    } finally {
      gate.release();
      holding = barrier;
    }
  });

  // The credential index alone keeps one row here, and answers the loser with the plugin's own failure
  // rather than a refusal the dialog can word.
  it("stores one authenticator enrolled twice at once as one row, and answers the loser with the conflict", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const raced = await atOnce([
      [a, AUTHENTICATOR_A],
      [b, AUTHENTICATOR_A],
    ]);

    assert.deepEqual({ ...raced, rows: (await passkeyRows()).length }, { ...ONE_WINS, rows: 1 });
  });

  it("keeps a stepped-up session at the cap when two enrolments start one below it", async () => {
    const cookie = await signIn(ADMIN_EMAIL);

    // A passkey-made session, made just now: the one shape the arm for a further passkey admits.
    await authDb()
      .collection("session")
      .updateMany({}, { $set: { authFactor: "passkey", createdAt: new Date() } });

    for (let index = 0; index < PASSKEY_LIMIT - 1; index += 1) {
      const held = await verify(await offer(cookie), Buffer.from(`fl-auth-db-held-${index}-${randomUUID()}`));
      assert.equal(held.status, 200, await held.clone().text());
    }

    const raced = await atOnce([
      [await offer(cookie), AUTHENTICATOR_A],
      [await offer(cookie), AUTHENTICATOR_B],
    ]);

    assert.deepEqual({ ...raced, rows: (await passkeyRows()).length }, { ...ONE_WINS, rows: PASSKEY_LIMIT });
  });

  // A claim on no row conflicts with nothing, so an enrolment reaching one is refused rather than
  // admitted unguarded.
  it("refuses an enrolment whose account row is gone by the time it is claimed", async () => {
    const offered = await offer(await signIn(ADMIN_EMAIL));

    // Gone before the transaction reads anything, so its snapshot holds no row to conflict over.
    consuming = () => authDb().collection("user").deleteMany({});
    const answer = await verify(offered, AUTHENTICATOR_A);

    assert.deepEqual({ status: answer.status, rows: (await passkeyRows()).length }, { status: 500, rows: 0 });
  });
});

/* The session a setup mints is written inside the transaction the patched plugin opens around the
   registration, so a setup the database refuses signs nobody in and nobody out
   (`docs/frontend/spec.md :: I399`). */
describe("a passkey setup that signs in, against a real database", () => {
  it("replaces the code's session with the passkey's, the credential stamped", async () => {
    const offered = await offer(await signIn(ADMIN_EMAIL));

    const enrolled = await verify(offered, AUTHENTICATOR_A, { createSession: true });
    assert.equal(enrolled.status, 200, await enrolled.clone().text());

    const sessions = await sessionRows();
    assert.deepEqual(
      sessions.map(({ authFactor, passkeyCredentialId }) => [authFactor, passkeyCredentialId]),
      [["passkey", AUTHENTICATOR_A.toString("base64url")]],
      "the code's session outlived the setup, or the passkey's was never written",
    );
  });

  it("mints one session for the winner of two setups at once, and leaves the loser signed in by code", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));
    const mailedBefore = sent.length;

    barrier.arm(2);
    const responses = await Promise.all([
      verify(a, AUTHENTICATOR_A, { createSession: true }),
      verify(b, AUTHENTICATOR_B, { createSession: true }),
    ]);
    barrier.disarm();
    assert.ok(await barrier.filled, "the setups were not both held at their first write, so no race was run");

    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(sent.length - mailedBefore, 1);
    const factors = (await sessionRows()).map(({ authFactor }) => authFactor).sort();
    assert.deepEqual(factors, ["code", "passkey"], "the refused setup minted a session or ended its caller's");
  });
});

describe("what a ban ends, against a real database (`docs/frontend/spec.md :: I402`)", () => {
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

    assert.deepEqual(
      (await sessionRows()).map(({ userId }) => String(userId)),
      [other.id],
      "a session of the barred account survived, or another account's was ended",
    );
    assert.equal((await authDb().collection("user").find({}).toArray()).length, 2);
    assert.equal((await passkeyRows()).length, 1);
  });
});

/* The memory adapter's `delete` removes every row it matches and MongoDB's removes one, so the
   clearing is judged here and nowhere else. */
describe("an address's failures after a code signs in, against a real database (`docs/frontend/spec.md :: I441`)", () => {
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
      await assert.rejects(
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: wrong }, headers: new Headers(ORIGIN) }),
        (error: { body?: { code?: unknown } }) => error.body?.code === "INVALID_OTP",
      );
    }
    assert.equal((await failureRows()).length, 2, "the failures were not counted, so the clearing below proves nothing");

    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp }, headers: new Headers(ORIGIN) });

    assert.deepEqual(await failureRows(), [], "a sign-in left failures standing against the address");
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
    gateAnswer = { sitze: [SITZ], gesperrt: true };
    const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });

    await assert.rejects(
      auth.api.signInEmailOTP({ body: { email, otp }, headers: new Headers(ORIGIN) }),
      (error: { body?: { code?: unknown } }) => error.body?.code === "SIGN_IN_BARRED",
    );
    assert.deepEqual(await failureRows(), [], "the refusal at the mint was counted as a failed code");

    const next = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
    await assert.rejects(
      auth.api.signInEmailOTP({ body: { email, otp: next === "000000" ? "111111" : "000000" }, headers: new Headers(ORIGIN) }),
      (error: { body?: { code?: unknown } }) => error.body?.code === "INVALID_OTP",
    );
    assert.equal((await failureRows()).length, 1);
  });
});

/* A wrong guess consumes the code and writes it back after its check. A send from another request,
   inside the consume's transaction, writes a newer code the written-back one must not outrank
   (`docs/frontend/spec.md :: I486`). */
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
    assert.equal(await guess, "INVALID_OTP");

    const fresh = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(fresh !== null && fresh !== stale, "the racing send mailed no new code");
    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: fresh }, headers });

    assert.equal((await sessionRows()).length, 1);
  });
});

/* The per-address mail cap's own race, on the real store: sends held at their count until the whole
   burst has arrived (`docs/frontend/spec.md :: I442`). */
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
   takes the passkey row back with it (`docs/frontend/spec.md :: I403`); the enrolment refuses a barred
   person before any mint (`:: I406`). */
describe("a set-up the gate refuses, against a real database", () => {
  it("writes no passkey for a person holding nothing by the set-up, and leaves them signed in by code", async () => {
    const email = "ohne-sitz-spaeter@example.org";

    gateAnswer = { sitze: [SITZ], gesperrt: false };
    const cookie = cookieHeader(await signInByCode(auth, email));
    assert.equal((await sessionRows()).length, 1, "the seated person was not signed in, so the case below proves nothing");

    const offered = await offer(cookie);
    gateAnswer = { sitze: [], gesperrt: false };
    const refused = await verify(offered, AUTHENTICATOR_A, { createSession: true });

    assert.equal(refused.status, 403, await refused.clone().text());
    assert.equal(((await refused.clone().json()) as { code?: string }).code, "SIGN_IN_HOLDS_NOTHING");
    assert.deepEqual(await passkeyRows(), [], "the refused set-up left its passkey behind");
    assert.deepEqual(
      (await sessionRows()).map(({ authFactor }) => authFactor),
      ["code"],
    );
  });
});

/* The typed code's own path through the mint: its creation hook stamps the factor and asks the gate,
   and the rotation ends the session the browser held (`docs/frontend/spec.md :: I399`, `:: I403`). */
describe("a code sign-in through the mint, against a real database", () => {
  const PERSON = "spielerin-mit-code@example.org";

  it("stamps the session it mints `code`, and ends the one the browser held", async () => {
    gateAnswer = { sitze: [SITZ], gesperrt: false };
    const held = await signIn(PERSON);
    const [before] = await sessionRows();
    assert.ok(before !== undefined, "the first code sign-in minted nothing, so nothing below is replaced");

    await signInByCode(auth, PERSON, { ...ORIGIN, cookie: held });

    const after = await sessionRows();
    assert.deepEqual(
      after.map(({ authFactor }) => authFactor),
      ["code"],
      "the replaced session outlived the new one, or the new one was never written",
    );
    assert.notEqual(after[0]?.token, before.token);
  });

  /* The sibling read and delete run on the real adapter's id and reference types, which the memory
     store's plain strings never test (`docs/frontend/spec.md :: I485`). */
  it("leaves only the later of two sessions minted to replace one cookie", async () => {
    gateAnswer = { sitze: [SITZ], gesperrt: false };
    const held = await signIn(PERSON);

    const earlier = cookieHeader(await signInByCode(auth, PERSON, { ...ORIGIN, cookie: held }));
    const later = cookieHeader(await signInByCode(auth, PERSON, { ...ORIGIN, cookie: held }));

    const opens = async (cookie: string) => (await auth.api.getSession({ headers: new Headers({ ...ORIGIN, cookie }) })) !== null;
    assert.deepEqual(
      { rows: (await sessionRows()).length, open: [await opens(earlier), await opens(later)] },
      { rows: 1, open: [false, true] },
      "the earlier replacement outlived the later one, held by no cookie",
    );
  });

  it("mints nothing for a barred address and ends nothing the browser held", async () => {
    gateAnswer = { sitze: [SITZ], gesperrt: false };
    const held = await signIn(PERSON);
    const before = await sessionRows();

    gateAnswer = { sitze: [SITZ], gesperrt: true };
    await assert.rejects(signInByCode(auth, PERSON, { ...ORIGIN, cookie: held }), (error: { body?: { code?: unknown } }) => {
      return error.body?.code === "SIGN_IN_BARRED";
    });

    assert.deepEqual(await sessionRows(), before, "a refused code sign-in minted a session or ended the held one");
  });
});

/* The slide's write is the Mongo adapter's update by token, which the memory store's plain objects
   never test: an update matching nothing signs the reader out instead. */
describe("a session only read, against a real database (`docs/frontend/spec.md :: I495`, `:: I496`)", () => {
  it("slides the stored row once past `updateAge` at the proxy, and never at a guard's read", async () => {
    const { readServedSession } = await import("./auth.ts");
    const { proxy } = await import("../proxy.ts");
    const { NextRequest } = await import("next/server");

    gateAnswer = { sitze: [SITZ], gesperrt: false };
    const cookie = await signIn("leserin-mit-code@example.org");
    const expiresIn = (auth.options.session?.expiresIn ?? Number.NaN) * 1000;
    const updatedAt = new Date(Date.now() - (auth.options.session?.updateAge ?? Number.NaN) * 1000 - 60_000);
    await authDb()
      .collection("session")
      .updateMany({}, { $set: { updatedAt: updatedAt, expiresAt: new Date(updatedAt.getTime() + expiresIn) } });
    const stamps = async () => (await sessionRows()).map((row) => [(row.updatedAt as Date).getTime(), (row.expiresAt as Date).getTime()]);
    const due = await stamps();

    assert.ok(await readServedSession(new Headers({ ...ORIGIN, cookie })), "the guard read no session, so the case proves nothing");
    assert.deepEqual(await stamps(), due, "a guard's read wrote the row");

    const before = Date.now();
    await proxy(new NextRequest("http://localhost:3000/bereich/konto", { headers: { ...ORIGIN, cookie } }));

    const [[slidAt = 0, lapsesAt = 0] = []] = await stamps();
    assert.ok(slidAt >= before && lapsesAt >= before + expiresIn, "the proxy's read left the stored row where it was");
  });
});
