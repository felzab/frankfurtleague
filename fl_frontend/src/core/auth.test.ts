import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, describe, it } from "node:test";

import { ObjectId } from "mongodb";

import type { Session } from "next-auth";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const COLLECTIONS = "__flAuthSessionCollections";

/** A single-segment subpath such as `next/headers`, leaving a deep `next/dist/…` path to Node. */
const NEXT_SUBPATH = /^next\/[\w-]+$/;

const ADMIN_EMAIL = "vorstand@example.org";

const CONFIG_DOUBLE = `export const frontend_config = {
  ALLOWED_ADMIN_EMAILS: ["${ADMIN_EMAIL}"],
  AUTH_URL: "http://localhost:3000",
  LOG_LEVEL: "ERROR",
  LOG_FORMAT: "json",
};`;

// Replaced at the module boundary rather than the adapter being given a seam: the real module opens a
// `MongoClient` at import, so loading it would reach for a server no test run holds.
const DB_DOUBLE = `export const client = {
  db: () => ({ collection: (name) => globalThis.${COLLECTIONS}[name] }),
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    // `next` publishes no `exports` map, so Node's resolver has no subpath to consult and only a file
    // path resolves. Both `next-auth` and the application import these bare.
    if (NEXT_SUBPATH.test(specifier)) return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/db.ts")) return { format: "module", source: DB_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** Fabricated. The real one is the credential this file exists to keep out of a response body. */
const SESSION_TOKEN = "fabricated-session-token-1d0f4c2b";

const USER_ID = new ObjectId("0123456789abcdef01234567");

const sessionDocument = {
  _id: new ObjectId("fedcba98765432100fedcba9"),
  sessionToken: SESSION_TOKEN,
  userId: USER_ID,
  // A full `maxAge` out, so `updateAge` has not elapsed and the read draws no write the double
  // would have to answer.
  expires: new Date(Date.now() + 48 * 60 * 60 * 1000),
};

// The email provider's profile carries an id, an address and the verification stamp, and the adapter
// writes exactly that -- so a fixture holding more asserts a body no administrator receives.
const userDocument = { _id: USER_ID, email: ADMIN_EMAIL, emailVerified: new Date(0) };

(globalThis as unknown as Record<string, unknown>)[COLLECTIONS] = {
  sessions: { findOne: async ({ sessionToken }: { sessionToken: string }) => (sessionToken === SESSION_TOKEN ? sessionDocument : null) },
  users: { findOne: async ({ _id }: { _id: ObjectId }) => (_id.equals(USER_ID) ? userDocument : null) },
  accounts: {},
  verification_tokens: {},
};

// `@auth/core` refuses a config carrying no secret, and the real one is a credential no test holds.
// Restored because the runner's one-process mode would otherwise carry this into every later module.
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "fabricated-test-secret-not-a-credential";
after(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

// Imported here rather than at the top, both of them: a static import resolves before the hook above
// is registered, so neither the alias nor the `next/server` extension would be in place yet.
const { NextRequest, NextResponse } = await import("next/server");
const { auth, handlers } = await import("./auth.ts");

function signedInRequest() {
  return new NextRequest("http://localhost:3000/api/auth/session", {
    headers: { cookie: `authjs.session-token=${SESSION_TOKEN}` },
  });
}

/** The route `fl_frontend/src/app/api/auth/[...nextauth]/route.ts` exports, driven as a browser reaches it. */
function readSession(): Promise<Response> {
  return handlers.GET(signedInRequest());
}

/**
 * The session `fl_frontend/src/proxy.ts` is handed, which reaches it through `auth()` rather than the
 * route. `next-auth` wraps the callback below on that path alone, so the two answers can differ.
 */
async function sessionSeenByTheProxy(): Promise<Session | null> {
  let seen: Session | null = null;
  const guarded = auth((request) => {
    seen = request.auth;
    return NextResponse.next();
  });

  // Forwarded to the callback untouched and read by neither, so this stands in for the
  // `NextFetchEvent` Next hands the real proxy; the shape is only what the overload demands.
  await guarded(signedInRequest(), { params: Promise.resolve({}) });
  return seen;
}

describe("the session endpoint's response body", () => {
  it("answers a signed-in administrator with the role the allowlist decides", async () => {
    const response = await readSession();
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body?.user?.email, ADMIN_EMAIL);
    assert.equal(body?.user?.role, "admin");
  });

  it("never carries the session cookie's own value, which is the bearer credential the flag protects", async () => {
    const body = await (await readSession()).json();

    assert.ok(!("sessionToken" in body), "the body names `sessionToken`, so `httpOnly` buys nothing against a script on the page");
    assert.ok(!JSON.stringify(body).includes(SESSION_TOKEN), "the cookie's value reaches the body under some other key");
  });

  it("carries the presentation fields and the role, and nothing else", async () => {
    const body = await (await readSession()).json();

    assert.deepEqual(Object.keys(body).sort(), ["expires", "user"]);
    assert.deepEqual(Object.keys(body.user).sort(), ["email", "role"]);
  });
});

describe("what the narrowed session still gives the guards", () => {
  it("keeps the two fields `getAdminSession` reads, so narrowing the body cannot fail admin open or shut", async () => {
    const seen = await sessionSeenByTheProxy();

    assert.equal(seen?.user?.role, "admin");
    assert.equal(seen?.user?.email, ADMIN_EMAIL);
  });

  it("keeps the session token out of the proxy's copy too, which `auth()` widens rather than filters", async () => {
    const seen = await sessionSeenByTheProxy();

    assert.ok(!JSON.stringify(seen).includes(SESSION_TOKEN), "the cookie's value reaches the request the proxy inspects");
  });
});
