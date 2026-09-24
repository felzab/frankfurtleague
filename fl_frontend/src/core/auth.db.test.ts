import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";

import {
  ADMIN_EMAIL,
  Barrier,
  BARRIER_TIMEOUT_MS,
  configDouble,
  cookieHeader,
  lastMailedToken,
  ORIGIN,
  registerAuthDoubles,
} from "./authDoubles.ts";

// A replica set, which the module starts by default: why this file needs one is
// `docs/frontend/spec.md` §1.9's.
const mongod = await new MongoDBContainer("mongo:8").start();

// The set advertises its container-internal address, which topology discovery would follow and find nothing.
const MONGO_URL = `${mongod.getConnectionString()}/?directConnection=true`;

const SENT = "__flAuthDbSentMail";
const BARRIER = "__flAuthDbBarrier";
const LOGGED = "__flAuthDbLogged";
const CONSUMING = "__flAuthDbConsuming";
const REAL_CLIENT = "__flAuthDbRealClient";

// A second URL for the production module, which the load hook's match on a path's end lets past the
// double: the client under test is the one `fl_frontend/src/core/db.ts` builds, Stable API included.
const PRODUCTION_DB = `${import.meta.resolve("./db.ts")}?production`;

/* The real client, held where a request makes its first write after its judgement: the passkey row
   where nothing claims the account, the account's own row where something does. */
const DB_DOUBLE = `import { client as real } from ${JSON.stringify(PRODUCTION_DB)};
globalThis.${REAL_CLIENT} = real;
const bound = (target, value) => (typeof value === "function" ? value.bind(target) : value);
const HELD = { passkey: "insertOne", user: "findOneAndUpdate" };
const wrapCollection = (name, collection) => new Proxy(collection, { get(target, prop) {
  if (HELD[name] === prop) return async (...args) => { await globalThis.${BARRIER}.arrive(); return target[prop](...args); };
  if (name === "verification" && prop === "findOneAndDelete") return async (...args) => { await globalThis.${CONSUMING}(); return target[prop](...args); };
  return bound(target, Reflect.get(target, prop, target));
}});
const wrapDb = (db) => new Proxy(db, { get(target, prop) {
  if (prop === "collection") return (name, options) => wrapCollection(name, target.collection(name, options));
  return bound(target, Reflect.get(target, prop, target));
}});
export const client = new Proxy(real, { get(target, prop) {
  if (prop === "db") return (name, options) => wrapDb(target.db(name, options));
  return bound(target, Reflect.get(target, prop, target));
}});`;

const MAIL_DOUBLE = `export const sendMail = async (message) => { globalThis.${SENT}.push(message); return { id: null }; };`;
const LOGGING_DOUBLE = `export const logger = {
  debug: () => {},
  info: () => {},
  warn: (message) => globalThis.${LOGGED}.push(message),
  error: () => {},
};`;

registerAuthDoubles({
  core: { config: configDouble({ MONGODB_URI: MONGO_URL }), db: DB_DOUBLE, mail: MAIL_DOUBLE, logging: LOGGING_DOUBLE },
});

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

const sent: { to: string; subject: string; text: string }[] = [];
const warnings: string[] = [];
const barrier = new Barrier();
const globals = globalThis as unknown as Record<string, unknown>;
globals[SENT] = sent;
globals[LOGGED] = warnings;
globals[BARRIER] = barrier;

/** What runs as the verify half consumes its challenge: after its session was read, before its transaction. */
let consuming: () => Promise<unknown> = async () => undefined;
globals[CONSUMING] = () => consuming();

// Imported after the hooks above are registered: a static import resolves before they exist.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth, PASSKEY_LIMIT } = await import("./auth.ts");
const { ENROLMENT_CONFLICT } = await import("./passkeyRefusal.ts");

type Collection = {
  find: (filter: object) => { toArray: () => Promise<Record<string, unknown>[]> };
  updateMany: (filter: object, update: object) => Promise<unknown>;
  deleteMany: (filter: object) => Promise<unknown>;
  createIndex: (spec: object, options: object) => Promise<unknown>;
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
  consuming = async () => undefined;
  await authDb().dropDatabase();
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

/** A link-borne session, minted the way a followed link mints one. */
async function signIn(email: string): Promise<string> {
  await auth.api.signInMagicLink({ body: { email }, headers: new Headers(ORIGIN) });
  const verified = await auth.api.magicLinkVerify({
    query: { token: lastMailedToken(sent, email) ?? assert.fail(`nothing was mailed to ${email}`) },
    headers: new Headers(ORIGIN),
    returnHeaders: true,
  });
  return cookieHeader(verified);
}

// A P-256 COSE key the plugin can parse; the attestation is "none", so nothing signs.
const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = publicKey.export({ format: "jwk" });
const COSE_KEY = Buffer.concat([
  Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
  Buffer.from(jwk.x ?? "", "base64url"),
  Buffer.from([0x22, 0x58, 0x20]),
  Buffer.from(jwk.y ?? "", "base64url"),
]);

function attestationObject(rawId: Buffer): Buffer {
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(rawId.length);
  // RP id hash, the flags user-present, user-verified and attested-credential-data, a zero counter
  // and a zero AAGUID.
  const authData = Buffer.concat([
    createHash("sha256").update("localhost").digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    idLength,
    rawId,
    COSE_KEY,
  ]);
  const dataLength = Buffer.alloc(2);
  dataLength.writeUInt16BE(authData.length);
  return Buffer.concat([
    Buffer.from([0xa3, 0x63]),
    Buffer.from("fmt"),
    Buffer.from([0x64]),
    Buffer.from("none"),
    Buffer.from([0x67]),
    Buffer.from("attStmt"),
    Buffer.from([0xa0, 0x68]),
    Buffer.from("authData"),
    Buffer.from([0x59]),
    dataLength,
    authData,
  ]);
}

function registrationFor(challenge: string, rawId: Buffer) {
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin: "http://localhost:3000", crossOrigin: false }));
  return {
    id: rawId.toString("base64url"),
    rawId: rawId.toString("base64url"),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData.toString("base64url"),
      attestationObject: attestationObject(rawId).toString("base64url"),
      transports: ["internal"],
    },
  };
}

type Offered = { cookie: string; challenge: string };

/** The options half, run to completion: what the verify half then needs to be posted. */
async function offer(cookie: string): Promise<Offered> {
  const offered = await overHttp("/passkey/generate-register-options", { cookie });
  assert.equal(offered.status, 200, await offered.clone().text());
  const { challenge } = (await offered.json()) as { challenge: string };
  return { cookie: `${cookie}; ${cookieHeader(offered)}`, challenge };
}

function verify(offered: Offered, rawId: Buffer): Promise<Response> {
  return overHttp("/passkey/verify-registration", {
    method: "POST",
    cookie: offered.cookie,
    body: { response: registrationFor(offered.challenge, rawId) },
  });
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

  const refused = responses.filter((response) => response.status !== 200);
  const codes = await Promise.all(refused.map(async (response) => ((await response.json()) as { code?: unknown }).code));
  return { statuses: responses.map((response) => response.status).sort(), codes, notices: sent.length - mailedBefore, warnings: [...warnings] };
}

// A hand-made unique index, named as `docs/ops/runbooks.md` asks: never a name a release could generate.
const createCredentialIndex = () =>
  authDb().collection("passkey").createIndex({ credentialID: 1 }, { unique: true, name: "credential_id_unique_by_hand" });

const AUTHENTICATOR_A = Buffer.from("fl-auth-db-authenticator-a");
const AUTHENTICATOR_B = Buffer.from("fl-auth-db-authenticator-b");

/** One enrolment stands, the other answers the conflict, one notice is mailed and one line is written. */
const ONE_WINS = { statuses: [200, 409], codes: [ENROLMENT_CONFLICT], notices: 1, warnings: ["auth.passkey_enrolment_conflict"] };

describe("two enrolments of one administrator at once, against a real database (`docs/frontend/spec.md :: I341`)", () => {
  // The clause holding in sequence is what the concurrent cases below are measured against.
  it("refuses a second link-borne enrolment made after the first", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const first = await verify(a, AUTHENTICATOR_A);
    const second = await verify(b, AUTHENTICATOR_B);

    assert.deepEqual([first.status, second.status, (await passkeyRows()).length], [200, 404, 1]);
  });

  // A stolen mailbox racing the administrator's own first enrolment: without the claim both rows
  // stand and neither side is refused.
  it("lets one of two link-borne sessions judged at zero rows enrol", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const raced = await atOnce([
      [a, AUTHENTICATOR_A],
      [b, AUTHENTICATOR_B],
    ]);

    assert.deepEqual({ ...raced, rows: (await passkeyRows()).length }, { ...ONE_WINS, rows: 1 });
  });

  it("lets one of two link-borne sessions enrol while the credential index stands", async () => {
    await createCredentialIndex();
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
    globals[BARRIER] = gate;

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
      globals[BARRIER] = barrier;
    }
  });

  it("stores one authenticator enrolled twice at once as one row", async () => {
    const a = await offer(await signIn(ADMIN_EMAIL));
    const b = await offer(await signIn(ADMIN_EMAIL));

    const raced = await atOnce([
      [a, AUTHENTICATOR_A],
      [b, AUTHENTICATOR_A],
    ]);

    assert.deepEqual({ ...raced, rows: (await passkeyRows()).length }, { ...ONE_WINS, rows: 1 });
  });

  // The index alone keeps one row here, and answers the loser with the plugin's own failure rather
  // than a refusal the dialog can word.
  it("answers the loser of one authenticator enrolled twice with the conflict while the credential index stands", async () => {
    await createCredentialIndex();
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
