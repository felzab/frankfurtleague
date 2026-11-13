import { ADMIN_EMAIL, configDouble, cookieHeader, ORIGIN, overriding, registerAuthDoubles, signInByCode } from "@/test-support/authDoubles.ts";
import { beginRenderPass, serveServerReact } from "@/test-support/cacheScope.ts";
import { replicaSetUrl, startJudgedReplicaSet } from "@/test-support/expiredTransactions.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { MongoClient } from "mongodb";

const { mongod, closing } = await startJudgedReplicaSet();

/** What the request a case arrives as carries. */
let requestHeaders: Headers | undefined;

// The real `fl_frontend/src/core/db.ts`, which the auth doubles replace by default: the client
// under test is the one it builds.
const PRODUCTION_DB = "@/core/db.ts";

/** Each error line written, which the index build's failures are among. */
const errors: string[] = [];

registerAuthDoubles({
  core: {
    config: configDouble({}, { mongodbUri: () => replicaSetUrl(mongod) }),
    db: overriding(PRODUCTION_DB, {}),
    logging: {
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: (message: string) => void errors.push(message) },
    },
  },
  specifiers: {
    "next/headers": { headers: () => Promise.resolve(requestHeaders) },
    // Called by no case here.
    "next/cache": { refresh: () => undefined },
  },
});

// The server build for these alone, whose `cache` memoizes where the client build's passes through;
// the library's own `react` stays the build it ships against.
serveServerReact();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { signInStore } = (await import(PRODUCTION_DB)) as { signInStore: () => MongoClient };
const client = signInStore();
closing(() => client.close());
const { auth } = await import("@/core/auth/library.ts");
const { getAccountSession, getAdminSession } = await import("@/core/auth/guards.ts");
const { getPasskeyStep } = await import("@/core/auth/landing.ts");
const { buildAuthIndexes } = await import("@/core/authIndexes.ts");
const { getSubjectSession } = await import("@/core/subject.ts");
const { devicesOf } = await import("@/features/account/security");
const { heldPasskeysOf } = await import("@/features/passkeys/held.ts");

// Production's indexes under every case, so the library is driven over what it meets there, and an
// empty store, each case signing the administrator in afresh.
beforeEach(async () => {
  errors.length = 0;
  await Promise.all(["session", "user", "passkey", "verification"].map((name) => client.db("auth").collection(name).deleteMany({})));
  await buildAuthIndexes();
  expect(errors, "an index of the sign-in store was left unbuilt").toStrictEqual([]);
});

// Set before the first operation opens a connection, which is when the pool reads it; the option is
// the client's own, left out of its published type.
Reflect.set(client, "monitorCommands", true);
/** Every command sent to the sign-in store, by its name and the collection it names. */
const sent: string[] = [];
client.on("commandStarted", (event) => {
  if (event.databaseName === "auth") sent.push(`${event.commandName} ${String(event.command[event.commandName])}`);
});

/** The commands `read` sends, in the order it sends them. */
async function sentBy(read: () => Promise<unknown>): Promise<string[]> {
  const before = sent.length;
  await read();
  return sent.slice(before);
}

/** The passkey the administrator signs in with. */
const CREDENTIAL_ID = "fl-admin-session-db";

/**
 * Signs the administrator in, and makes the session one a passkey its row still holds minted, which
 * alone the guard admits.
 */
async function signInAsAdministrator(): Promise<Headers> {
  const verified = await signInByCode(auth, ADMIN_EMAIL);
  await client
    .db("auth")
    .collection("session")
    .updateMany({}, { $set: { authFactor: "passkey", passkeyCredentialId: CREDENTIAL_ID, createdAt: new Date() } });

  const [user] = await client.db("auth").collection("user").find({}).toArray();
  assert.ok(user, "the sign-in wrote no user row");
  // Written through the library's adapter, so the row is in the shape the plugin's own writes give it.
  const { adapter } = await auth.$context;
  await adapter.create({
    model: "passkey",
    data: {
      userId: String(user._id),
      credentialID: CREDENTIAL_ID,
      publicKey: "fabricated-public-key",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      createdAt: new Date(),
    },
  });

  return new Headers({ ...ORIGIN, cookie: cookieHeader(verified) });
}

/** Puts every stored session where the library's next refreshing read would write it, its windows untouched. */
async function dueForRefresh(): Promise<() => Promise<unknown[]>> {
  const sessions = client.db("auth").collection<{ updatedAt: Date; expiresAt: Date }>("session");
  const updateAge = (auth.options.session?.updateAge ?? Number.NaN) * 1000;
  // The library refreshes by how far `expiresAt` has run down, never by `updatedAt`, which the guards' idle windows read.
  await sessions.updateMany({}, [{ $set: { expiresAt: { $subtract: ["$expiresAt", 2 * updateAge] } } }]);
  return async () => (await sessions.find({}).toArray()).map(({ updatedAt, expiresAt }) => [updatedAt, expiresAt]);
}

/* A render cannot write the cookie, so a read that refreshes the row from one carries it past the
   cookie the browser holds: the library's own passkey list reads the
   session that way. */
describe("the account and passkey pages, each across one render pass", () => {
  it("reads the account page's session once for its three guards and writes no row", async () => {
    requestHeaders = await signInAsAdministrator();
    const stamps = await dueForRefresh();
    const due = await stamps();

    beginRenderPass();
    const commands = await sentBy(async () => {
      assert.ok(await getSubjectSession(), "the person guard refused the administrator");
      const served = await getAccountSession();
      assert.ok(served, "the account page's guard refused the administrator, so the count below counts a refusal");
      await Promise.all([heldPasskeysOf(served), devicesOf(served)]);
    });

    // The guards' one read, the check its passkey stands, the page's passkeys and its sign-ins.
    expect(commands.toSorted()).toStrictEqual(["aggregate passkey", "aggregate passkey", "aggregate session", "aggregate session"]);
    expect(await stamps(), "a read of the account page slid the session").toStrictEqual(due);
  });

  it("reads the passkey page's session once and writes no row", async () => {
    // A code's session, which the page offers the administrator's enrolment.
    requestHeaders = new Headers({ ...ORIGIN, cookie: cookieHeader(await signInByCode(auth, ADMIN_EMAIL)) });
    const stamps = await dueForRefresh();
    const due = await stamps();

    beginRenderPass();
    let step: unknown;
    const commands = await sentBy(async () => {
      step = await getPasskeyStep();
    });

    expect(step, "the page offered no step, so the count below counts nothing").toStrictEqual({ step: "enrol", email: ADMIN_EMAIL });
    expect(commands).toStrictEqual(["aggregate session", "aggregate passkey"]);
    expect(await stamps(), "a read of the passkey page slid the session").toStrictEqual(due);
  });
});

/** A second account, holding one passkey and no session: what a read scoped to the holder must never count. */
async function aSecondAccountsPasskey(): Promise<void> {
  const { adapter } = await auth.$context;
  const other = await adapter.create<{ name: string; email: string; emailVerified: boolean }, { id: string }>({
    model: "user",
    data: { name: "", email: "zweite.person@example.org", emailVerified: true },
  });
  await adapter.create({
    model: "passkey",
    data: {
      userId: other.id,
      credentialID: "fl-admin-session-db-second-account",
      publicKey: "fabricated-public-key",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      createdAt: new Date(),
    },
  });
}

/* The passkeys are read by the holder's id alone, never through the library's session-scoped list:
   that id is the one thing keeping another account's names, last use and count off these reads. */
describe("the holder's passkeys, with another account's beside them in the store", () => {
  it("lists the holder's passkey alone on the account page", async () => {
    // After the holder's sign-in, which takes the passkey it makes to the first account row it finds.
    requestHeaders = await signInAsAdministrator();
    await aSecondAccountsPasskey();

    beginRenderPass();
    const served = await getAccountSession();
    assert.ok(served, "the account page's guard refused the administrator");
    const { rows } = await heldPasskeysOf(served);

    expect(rows.length, "the account page listed another account's passkey").toBe(1);
  });

  it("offers a holder of no passkey the enrolment, not the sign-in by another account's", async () => {
    await aSecondAccountsPasskey();
    requestHeaders = new Headers({ ...ORIGIN, cookie: cookieHeader(await signInByCode(auth, ADMIN_EMAIL)) });

    beginRenderPass();

    expect(await getPasskeyStep()).toStrictEqual({ step: "enrol", email: ADMIN_EMAIL });
  });
});

/* The account row reaches the guards through the session read's own `$lookup`, which the unit tier's
   memory adapter implements apart: a stamp or a row lost in that join serves a session the ending
   ended. */
describe("the account row the session read joins, against a real store", () => {
  it("refuses a session its account's ending stamp postdates, at every guard", async () => {
    const { readServedSession } = await import("@/core/auth/session.ts");
    requestHeaders = await signInAsAdministrator();
    beginRenderPass();
    assert.ok(await getAdminSession(), "the administrator was refused before the stamp, so the refusals below prove nothing");

    await client
      .db("auth")
      .collection("user")
      .updateMany({}, { $set: { sessionsEndedAt: new Date(Date.now() + 1000) } });

    beginRenderPass();
    expect(await getAdminSession(), "the administrator's guard served a stamped session").toBe(null);
    expect(await readServedSession(requestHeaders), "the served read served a stamped session").toBe(null);
  });

  it("serves no session whose account row is gone, the session row standing", async () => {
    const { readServedSession } = await import("@/core/auth/session.ts");
    requestHeaders = await signInAsAdministrator();
    await client.db("auth").collection("user").deleteMany({});
    expect(await client.db("auth").collection("session").countDocuments({}), "the session row went with the account's").toBe(1);

    beginRenderPass();
    expect(await getAdminSession()).toBe(null);
    expect(await readServedSession(requestHeaders)).toBe(null);
  });
});
