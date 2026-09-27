import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, beforeEach, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";

import { ADMIN_EMAIL, asDataUrl, configDouble, cookieHeader, ORIGIN, registerAuthDoubles, signInByCode } from "@/core/authDoubles.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, SERVER_REACT_URL } from "@/core/cacheScope.ts";
import { exportingModule, overridingModule } from "@/core/exportingModule.ts";

import type { StartedMongoDBContainer } from "@testcontainers/mongodb";
import type { CommandStartedEvent, MongoClient } from "mongodb";

/* Each resource set as it opens, and the hook registered before the first await that can throw: a
   container that started is stopped whatever fails after it. */
const opened: { mongod?: StartedMongoDBContainer; client?: MongoClient } = {};

after(async () => {
  await opened.client?.close();
  await opened.mongod?.stop();
});

const mongod = await new MongoDBContainer("mongo:8.3.11").start();
opened.mongod = mongod;

/** What the request a case arrives as carries. */
let requestHeaders: Headers | undefined;

// The query suffix takes the real module past the load hook's match on a path's end: the client
// counted is the one `fl_frontend/src/core/db.ts` builds.
const PRODUCTION_DB = `${import.meta.resolve("@/core/db.ts")}?production`;

/** Each error line written, which the index build's failures are among. */
const errors: string[] = [];

registerAuthDoubles({
  core: {
    config: configDouble({ MONGODB_URI: `${mongod.getConnectionString()}/?directConnection=true` }),
    db: overridingModule(PRODUCTION_DB, {}),
    logging: exportingModule({
      logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: (message: string) => void errors.push(message) },
    }),
  },
  specifiers: { "next/headers": asDataUrl(exportingModule({ headers: () => Promise.resolve(requestHeaders) })) },
});

// The server build for `auth.ts` alone, whose `cache` memoizes where the client build's passes
// through; the library's own `react` stays the build it ships against.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "react" && context.parentURL?.endsWith("/src/core/auth.ts") === true)
      return { url: SERVER_REACT_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// Imported after the hooks above are registered: a static import resolves before they exist.
const { client } = (await import(PRODUCTION_DB)) as { client: MongoClient };
opened.client = client;
const { auth, getAdminSession } = await import("@/core/auth.ts");
const { buildAuthIndexes } = await import("@/core/authIndexes.ts");

// Production's indexes under every case, so the library is driven over what it meets there.
beforeEach(async () => {
  errors.length = 0;
  await buildAuthIndexes();
  assert.deepEqual(errors, [], "an index of the sign-in store was left unbuilt");
});

// Set before the first operation opens a connection, which is when the pool reads it; the option is
// the client's own, left out of its published type.
Reflect.set(client, "monitorCommands", true);
const sessionReads: CommandStartedEvent[] = [];
client.on("commandStarted", (event) => {
  if (event.commandName === "aggregate" && event.command.aggregate === "session") sessionReads.push(event);
});

/** The passkey the administrator signs in with. */
const CREDENTIAL_ID = "fl-admin-session-db";

/**
 * Signs the administrator in, and makes the session one a passkey its row still holds minted, which
 * alone the guard admits (`docs/frontend/spec.md :: I313`).
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

describe("the administrator's session across one render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  /* The admin layout wraps the shell's season slot and the page segment in a guard each, and both
     run in one render pass: `fl_frontend/src/app/bereich/admin/layout.tsx :: AdminLayout`. */
  it("reads the store once for both of the layout's guards", async () => {
    requestHeaders = await signInAsAdministrator();

    beginRenderPass();
    const before = sessionReads.length;
    const [slot, page] = await Promise.all([getAdminSession(), getAdminSession()]);

    assert.equal(slot?.user.email, ADMIN_EMAIL, "the guard refused the administrator, so the count below counts a refusal");
    assert.equal(page?.user.email, ADMIN_EMAIL);
    assert.equal(sessionReads.length - before, 1, "the two guards of one render pass each read the session store");

    // The control: the next request is a new pass and reads again, so the counter counts reads.
    beginRenderPass();
    await getAdminSession();
    assert.equal(sessionReads.length - before, 2, "a second request was answered from the first one's read");
  });
});
