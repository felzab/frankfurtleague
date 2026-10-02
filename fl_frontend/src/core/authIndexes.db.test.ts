import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";
import { MongoClient, ObjectId } from "mongodb";

import {
  ADMIN_EMAIL,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  lastMailedCode,
  ORIGIN,
  registerAuthDoubles,
  signInByCode,
} from "./authDoubles.ts";
import { overridingModule } from "./exportingModule.ts";
import { assertionFor, CREDENTIAL_RAW_ID, registrationFor } from "./testAuthenticator.ts";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { CommandFailedEvent, CommandStartedEvent } from "mongodb";

/* Each resource set as it opens, and the hook registered before the first await that can throw: a
   container that started is stopped whatever fails after it. */
const opened: { mongod?: StartedMongoDBContainer; client?: MongoClient } = {};

after(async () => {
  await opened.client?.close();
  await opened.mongod?.stop();
});

// A replica set, which the module starts by default: the passkey writes run in transactions.
const mongod = await new MongoDBContainer("mongo:8.3.11").start();
opened.mongod = mongod;

// The query suffix takes the real module past the load hook's match on a path's end: the client
// under test is the one `fl_frontend/src/core/db.ts` builds.
const PRODUCTION_DB = `${import.meta.resolve("./db.ts")}?production`;

/** The server's code for a query it refused to plan while table scans are disabled. */
const NO_QUERY_EXECUTION_PLANS = 291;

/** Every command the store refused for want of an index, whatever the flow made of the refusal. */
const scans: string[] = [];
const started = new Map<number, CommandStartedEvent>();

const DB_DOUBLE = overridingModule(PRODUCTION_DB, {
  signInStore: (real) => {
    const client = (real.signInStore as () => MongoClient)();
    // Set before the first operation opens a connection, which is when the pool reads it; the option is
    // the client's own, left out of its published type.
    Reflect.set(client, "monitorCommands", true);
    client.on("commandStarted", (event) => started.set(event.requestId, event));
    client.on("commandFailed", (event: CommandFailedEvent) => {
      const command = started.get(event.requestId)?.command;
      if (Reflect.get(event.failure, "code") === NO_QUERY_EXECUTION_PLANS) scans.push(JSON.stringify(command));
    });
    opened.client = client;
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

const { sent } = registerAuthDoubles({
  core: {
    config: configDouble({ MONGODB_URI: `${mongod.getConnectionString()}/?directConnection=true`, ...GATE_BACKEND_CONFIG }),
    db: DB_DOUBLE,
    logging: LOGGING_DOUBLE,
  },
  specifiers: {
    "next/headers": { headers: () => Promise.resolve(requestHeaders) },
    // What the account page's spine calls once an action has written, which throws outside a server action.
    "next/cache": { refresh: () => undefined },
  },
});

// Imported after the hooks above are registered: a static import resolves before they exist.
const { toNextJsHandler } = await import("better-auth/next-js");
const { auth, endSessionsOfAddress, getKontoSession, readServedSession, removePasskey } = await import("./auth.ts");
const { buildAuthIndexes } = await import("./authIndexes.ts");
const { readSicherheit } = await import("@/features/konto/sicherheit");
const { endAndereAnmeldungenAction, endAnmeldungAction } = await import("@/features/konto/actions");

const store = () => (opened.client as MongoClient).db("auth");
const COLLECTIONS = ["session", "passkey", "user", "verification"] as const;

beforeEach(async () => {
  errors.length = 0;
  scans.length = 0;
  requestHeaders = undefined;
  await store().dropDatabase();
});

// The server parameter is outside the Stable API the production client is held to, so it is set over a
// client of the suite's own.
const operator = new MongoClient(`${mongod.getConnectionString()}/?directConnection=true`);
after(() => operator.close());

/** Runs `body` with table scans refused, recording each query the store could not serve from an index. */
async function refusingTableScans<T>(body: () => Promise<T>): Promise<T> {
  await operator.db("admin").command({ setParameter: 1, notablescan: true });
  try {
    return await body();
  } finally {
    await operator.db("admin").command({ setParameter: 1, notablescan: false });
  }
}

/**
 * One flow with table scans refused. A scan fails here, over whatever the flow made of the refusal:
 * the library answers one with a 404 or a `null` session, which names no query.
 */
async function withoutTableScans<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await refusingTableScans(body);
  } finally {
    assert.deepEqual(scans, [], "a query found no index to plan on");
  }
}

/** Every index the four collections hold, by collection, as `listIndexes` answers them. */
async function heldIndexes(): Promise<Record<string, Record<string, unknown>[]>> {
  const held: Record<string, Record<string, unknown>[]> = {};
  for (const collection of COLLECTIONS) held[collection] = await store().collection(collection).listIndexes().toArray();
  return held;
}

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

/** A passkey enrolled through both halves of the ceremony, answered as the verify half answers. */
async function enrol(cookie: string, rawId: Buffer): Promise<Response> {
  const offered = await overHttp("/passkey/generate-register-options", { cookie });
  assert.equal(offered.status, 200, await offered.clone().text());
  const { challenge } = (await offered.json()) as { challenge: string };

  return overHttp("/passkey/verify-registration", {
    method: "POST",
    cookie: `${cookie}; ${cookieHeader(offered)}`,
    body: { response: registrationFor(challenge, true, rawId) },
  });
}

/** A passkey sign-in over the credential `enrol` stored first. */
async function assertPasskey(cookie: string): Promise<Response> {
  const offered = await overHttp("/passkey/generate-authenticate-options", { cookie });
  assert.equal(offered.status, 200, await offered.clone().text());
  const { challenge } = (await offered.json()) as { challenge: string };

  return overHttp("/passkey/verify-authentication", {
    method: "POST",
    cookie: `${cookie}; ${cookieHeader(offered)}`,
    body: { response: assertionFor(challenge, true) },
  });
}

const asRequest = (cookie: string) => new Headers({ ...ORIGIN, cookie });

describe("every query the sign-in store serves, with table scans refused (`docs/frontend/spec.md :: I499`)", () => {
  /* The index list is derived from what this drives: a query no declared index serves fails here,
     whether or not the flow that sent it survives the failure. */
  it("plans each one on an index, from a code's send to a ban ending every session", async () => {
    await buildAuthIndexes();
    assert.deepEqual(errors, [], "an index was left unbuilt, so the flows below ran without it");

    // The control: without it a parameter the server ignored would pass everything below.
    await refusingTableScans(() =>
      assert.rejects(
        store().collection("session").find({ authFactor: "code" }).toArray(),
        (failed: { code?: unknown }) => failed.code === NO_QUERY_EXECUTION_PLANS,
      ),
    );
    assert.equal(scans.length, 1, "the monitor missed the refused scan, so an empty record below proves nothing");
    scans.length = 0;

    const headers = new Headers(ORIGIN);

    // A code mailed, one wrong guess counted against the address, and the mailed code signing in.
    await withoutTableScans(() => auth.api.sendVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" }, headers }));
    const code = lastMailedCode(sent, ADMIN_EMAIL);
    assert.ok(code !== null, "the send mailed nothing, so no code sign-in is driven");
    await withoutTableScans(() =>
      assert.rejects(
        auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: code === "000000" ? "111111" : "000000" }, headers }),
        (failed: { body?: { code?: unknown } }) => failed.body?.code === "INVALID_OTP",
      ),
    );
    const first = cookieHeader(
      await withoutTableScans(() => auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: code }, headers, returnHeaders: true })),
    );

    // A second code sign-in from the same browser, which ends the session it replaces.
    const byCode = cookieHeader(await withoutTableScans(() => signInByCode(auth, ADMIN_EMAIL, { ...ORIGIN, cookie: first })));

    // The administrator's first passkey, by the mailed code, and a sign-in by it.
    const enrolled = await withoutTableScans(() => enrol(byCode, CREDENTIAL_RAW_ID));
    assert.equal(enrolled.status, 200, await enrolled.clone().text());
    const asserted = await withoutTableScans(() => assertPasskey(byCode));
    assert.equal(asserted.status, 200, await asserted.clone().text());
    const byPasskey = cookieHeader(asserted);
    requestHeaders = asRequest(byPasskey);

    assert.ok(await withoutTableScans(() => readServedSession(asRequest(byPasskey))), "the passkey's session was not served");
    const served = await withoutTableScans(() => getKontoSession());
    assert.ok(served, "the account page refused the passkey's session");

    // Two more devices, one ended by its row and one with every other.
    await withoutTableScans(() => signInByCode(auth, ADMIN_EMAIL));
    await withoutTableScans(() => signInByCode(auth, ADMIN_EMAIL));
    const sicherheit = await withoutTableScans(() => readSicherheit(served));
    const [andere] = sicherheit.anmeldungen.filter(({ diesesGeraet }) => !diesesGeraet);
    assert.ok(andere, "the account page listed no other sign-in");
    assert.deepEqual(await withoutTableScans(() => endAnmeldungAction(andere.id)), { success: true, message: "Abgemeldet" });
    assert.deepEqual(await withoutTableScans(() => endAndereAnmeldungenAction()), { success: true, message: "Alle anderen abgemeldet" });

    // A second passkey, listed, renamed and removed.
    const second = await withoutTableScans(() => enrol(byPasskey, Buffer.from("fl-index-db-second-authenticator")));
    assert.equal(second.status, 200, await second.clone().text());
    const held = await withoutTableScans(() => auth.api.listPasskeys({ headers: asRequest(byPasskey) }));
    const removable = held.find(({ credentialID }) => credentialID !== CREDENTIAL_RAW_ID.toString("base64url"));
    assert.ok(removable && held.length === 2, "the second passkey was not listed beside the first");
    await withoutTableScans(() =>
      auth.api.updatePasskey({ body: { id: removable.id, name: "Zweitschlüssel" }, headers: asRequest(byPasskey) }),
    );
    assert.equal(await withoutTableScans(() => removePasskey({ id: served.user.id, email: ADMIN_EMAIL }, removable.id)), "removed");

    // The hourly refresh, which the library judges by how far the expiry has run down: the row is aged
    // two hours, so the read writes it again.
    const row = { _id: new ObjectId(served.session.id) };
    const minted = await store().collection("session").findOne(row);
    const aged = new Date(Number(minted?.expiresAt) - 2 * 60 * 60 * 1000);
    await store()
      .collection("session")
      .updateOne(row, { $set: { expiresAt: aged } });
    await withoutTableScans(() => auth.api.getSession({ headers: asRequest(byPasskey) }));
    const refreshed = await store().collection("session").findOne(row);
    assert.ok(refreshed && refreshed.expiresAt > aged, "the read refreshed nothing, so the refresh's write was not driven");

    // A sign-out, then a ban ending every session the address still holds.
    await withoutTableScans(() => signInByCode(auth, ADMIN_EMAIL));
    await withoutTableScans(() => auth.api.signOut({ headers: asRequest(byPasskey) }));
    await withoutTableScans(() => endSessionsOfAddress(ADMIN_EMAIL));

    assert.equal(await store().collection("session").countDocuments(), 0, "the ban left a session standing, so its query was not driven");
  });
});

describe("the index build against a real store (`docs/frontend/spec.md :: I498`)", () => {
  it("changes nothing when run again", async () => {
    await buildAuthIndexes();
    const built = await heldIndexes();

    await buildAuthIndexes();

    assert.deepEqual(errors, []);
    assert.deepEqual(await heldIndexes(), built);
  });

  // Production's hand-made indexes are the case: one standing under another name refuses its build.
  it("logs a same-key index standing under another name, and builds every other", async () => {
    await buildAuthIndexes();
    const reference = await heldIndexes();
    await store().dropDatabase();
    await store().collection("session").createIndex({ token: 1 }, { unique: true, name: "made_by_hand" });

    await buildAuthIndexes();

    assert.equal(errors.length, 1, JSON.stringify(errors));
    assert.deepEqual(errors[0], {
      event: "auth.index_unbuilt",
      fields: { error_code: "FE-AUTH-011", index: "session_token_uidx", name: "MongoServerError", code: 85, codeName: "IndexOptionsConflict" },
    });
    const names = (held: Record<string, Record<string, unknown>[]>) =>
      Object.entries(held).flatMap(([collection, indexes]) => indexes.map(({ name }) => `${collection}.${String(name)}`));
    assert.deepEqual(
      names(await heldIndexes()).sort(),
      [...names(reference).filter((name) => name !== "session.session_token_uidx"), "session.made_by_hand"].sort(),
    );
  });

  /* Production's store as its Atlas console listed it on 2026-09-27, beside each collection's `_id_`, and
     moving there without us: a list entry naming one of these otherwise is refused with code 85 on every boot. */
  it("builds over the indexes production's store was given by hand, refusing none", async () => {
    await store().collection("session").createIndex({ expiresAt: 1 }, { name: "expiresAt_1", expireAfterSeconds: 0 });
    await store().collection("verification").createIndex({ expiresAt: 1 }, { name: "expiresAt_1", expireAfterSeconds: 0 });
    await store().collection("passkey").createIndex({ credentialID: 1 }, { name: "credentialID_1", unique: true });

    await buildAuthIndexes();

    assert.deepEqual(errors, []);
  });

  it("logs the address index two accounts at one address refuse, never quoting the address", async () => {
    const account = { email: "doppelt@example.org", emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() };
    await store()
      .collection("user")
      .insertMany([{ ...account }, { ...account }]);

    await buildAuthIndexes();

    assert.deepEqual(
      errors.map(({ fields }) => fields),
      [{ error_code: "FE-AUTH-011", index: "user_email_uidx", name: "MongoServerError", code: 11000, codeName: "DuplicateKey" }],
    );
    assert.ok(!JSON.stringify(errors).includes("@"), "the line quoted the address the refusal named");
  });

  /* Read off the library's own schema rather than the list, so a field it declares unique, or an
     expiry it writes, is held to an index whether or not anybody declared one. */
  it("holds every field the library declares unique to a unique index, and every expiry it writes to an expiring one", async () => {
    await buildAuthIndexes();
    const held = await heldIndexes();
    const { tables } = await auth.$context;

    const served = Object.values(tables).filter(({ modelName }) => (COLLECTIONS as readonly string[]).includes(modelName));
    assert.deepEqual(
      served.map(({ modelName }) => modelName).sort(),
      [...COLLECTIONS].sort(),
      "a collection the store holds has no table here",
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
      assert.equal(await rows.countDocuments({ expiresAt: { $not: { $type: "date" } } }), 0, `${collection} holds an expiry no index deletes`);
    }
  });
});
