import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, describe, it } from "node:test";

import { MongoDBContainer } from "@testcontainers/mongodb";

import { ADMIN_EMAIL, asDataUrl, configDouble, cookieHeader, lastMailedToken, ORIGIN, registerAuthDoubles } from "@/core/authDoubles.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, SERVER_REACT_URL } from "@/shared/testing/cacheScope.ts";

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

const REQUEST_HEADERS = "__flAdminSessionRequestHeaders";
const globals = globalThis as unknown as Record<string, unknown>;

// The query suffix takes the real module past the load hook's match on a path's end: the client
// counted is the one `fl_frontend/src/core/db.ts` builds.
const PRODUCTION_DB = `${import.meta.resolve("@/core/db.ts")}?production`;

const { sent } = registerAuthDoubles({
  core: {
    config: configDouble({ MONGODB_URI: `${mongod.getConnectionString()}/?directConnection=true` }),
    db: `export { client } from ${JSON.stringify(PRODUCTION_DB)};`,
  },
  specifiers: { "next/headers": asDataUrl(`export const headers = async () => globalThis.${REQUEST_HEADERS};`) },
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

// Set before the first operation opens a connection, which is when the pool reads it; the option is
// the client's own, left out of its published type.
Reflect.set(client, "monitorCommands", true);
const sessionReads: CommandStartedEvent[] = [];
client.on("commandStarted", (event) => {
  if (event.commandName === "aggregate" && event.command.aggregate === "session") sessionReads.push(event);
});

/** Signs the administrator in, and makes the session one the passkey minted, which the guard admits. */
async function signInAsAdministrator(): Promise<Headers> {
  await auth.api.signInMagicLink({ body: { email: ADMIN_EMAIL }, headers: new Headers(ORIGIN) });
  const verified = await auth.api.magicLinkVerify({
    query: { token: lastMailedToken(sent, ADMIN_EMAIL) ?? assert.fail(`nothing was mailed to ${ADMIN_EMAIL}`) },
    headers: new Headers(ORIGIN),
    returnHeaders: true,
  });
  await client
    .db("auth")
    .collection("session")
    .updateMany({}, { $set: { authFactor: "passkey", createdAt: new Date() } });

  return new Headers({ ...ORIGIN, cookie: cookieHeader(verified) });
}

describe("the administrator's session across one render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  /* The admin layout wraps the shell's season slot and the page segment in a guard each, and both
     run in one render pass: `fl_frontend/src/app/bereich/admin/layout.tsx :: AdminLayout`. */
  it("reads the store once for both of the layout's guards", async () => {
    globals[REQUEST_HEADERS] = await signInAsAdministrator();

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
