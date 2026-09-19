import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { after, describe, it } from "node:test";

import { ObjectId } from "mongodb";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const COLLECTIONS = "__flProxySessionCollections";

/** A single-segment subpath such as `next/server`, leaving a deep `next/dist/…` path to Node. */
const NEXT_SUBPATH = /^next\/[\w-]+$/;

const ADMIN_EMAIL = "vorstand@example.org";
/** An address the allowlist below does not carry, whose session the role check is what refuses. */
const REMOVED_EMAIL = "ehemalig@example.org";

const CONFIG_DOUBLE = `export const frontend_config = {
  ALLOWED_ADMIN_EMAILS: ["${ADMIN_EMAIL}"],
  AUTH_URL: "http://localhost:3000",
  LOG_LEVEL: "ERROR",
  LOG_FORMAT: "json",
};`;

// Replaced at the module boundary rather than the adapter being given a seam: the real module opens
// a `MongoClient` at import, so loading it would reach for a server no test run holds.
const DB_DOUBLE = `export const client = {
  db: () => ({ collection: (name) => globalThis.${COLLECTIONS}[name] }),
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    // `next` publishes no `exports` map, so Node's resolver has no subpath to consult and only a file
    // path resolves. Both `next-auth` and the application import these bare.
    if (NEXT_SUBPATH.test(specifier)) return nextResolve(`${specifier}.js`, context);
    // Next's bundler aliases this to its own vendored copy, and no package of that name is installed.
    if (specifier === "react-server-dom-webpack/client") return nextResolve("next/dist/compiled/react-server-dom-webpack/client.js", context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/db.ts")) return { format: "module", source: DB_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** Both fabricated. A real one is the bearer credential no test file may carry. */
const ADMIN_TOKEN = "fabricated-admin-token-6b2c1f40";
const REMOVED_TOKEN = "fabricated-removed-token-8e17a3d5";

const ADMIN_ID = new ObjectId("0123456789abcdef01234567");
const REMOVED_ID = new ObjectId("89abcdef0123456776543210");

// A full `maxAge` out, so `updateAge` has not elapsed and the read draws no write the double would
// have to answer.
const EXPIRES = new Date(Date.now() + 48 * 60 * 60 * 1000);

const sessionRows = new Map(
  [
    [ADMIN_TOKEN, ADMIN_ID],
    [REMOVED_TOKEN, REMOVED_ID],
  ].map(([sessionToken, userId]) => [
    sessionToken as string,
    { _id: new ObjectId(), sessionToken: sessionToken as string, userId: userId as ObjectId, expires: EXPIRES },
  ]),
);

const userRows = new Map(
  [
    [ADMIN_ID, ADMIN_EMAIL],
    [REMOVED_ID, REMOVED_EMAIL],
  ].map(([id, email]) => [(id as ObjectId).toHexString(), { _id: id as ObjectId, email: email as string, emailVerified: new Date(0) }]),
);

(globalThis as unknown as Record<string, unknown>)[COLLECTIONS] = {
  sessions: { findOne: async ({ sessionToken }: { sessionToken: string }) => sessionRows.get(sessionToken) ?? null },
  users: { findOne: async ({ _id }: { _id: ObjectId }) => userRows.get(_id.toHexString()) ?? null },
  accounts: {},
  verification_tokens: {},
};

// `@auth/core` refuses a config carrying no secret, and the real one is a credential no test holds.
// Restored because `--test-isolation=none` would otherwise carry this into every later file.
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "fabricated-test-secret-not-a-credential";
after(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

// Imported here rather than at the top, both of them: a static import resolves before the hook above
// is registered, so neither the alias nor the `next/server` extension would be in place yet.
const { NextRequest } = await import("next/server");
const { default: proxy } = await import("./proxy.ts");

const ADMIN_URL = "http://localhost:3000/admin/spiele";

/** What react-dom fills the header with; the value is never read, only its presence. */
const ACTION_ID = "6f1b0c9d4a2e8f37";

/** Every method react-dom cannot be sending an action on, so each is a page request. */
const RENDERING_METHODS = ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];

type Arrival = { method?: string; action?: boolean; token?: string };

async function arriveAtAdmin({ method = "GET", action = false, token }: Arrival = {}): Promise<Response> {
  const headers = new Headers();
  if (action) headers.set("next-action", ACTION_ID);
  if (token !== undefined) headers.set("cookie", `authjs.session-token=${token}`);

  // Forwarded to the callback untouched and read by neither, so this stands in for the
  // `NextFetchEvent` Next hands the real proxy; the shape is only what the overload demands.
  const answer = await proxy(new NextRequest(ADMIN_URL, { method, headers }), { params: Promise.resolve({}) });

  assert.ok(answer instanceof Response, "the proxy answered something other than a response");
  return answer;
}

/** The path a redirect names, or `null` where the request was let through to the route. */
function redirectedTo(answer: Response): string | null {
  const location = answer.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

describe("where the admin proxy sends a signed-out request", () => {
  it("redirects a plain page request", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin()), "/signin");
  });

  it("redirects a GET carrying `next-action`, which Next reads as a page render rather than an action", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin({ action: true })), "/signin");
  });

  it("redirects every other method carrying `next-action`", async () => {
    for (const method of RENDERING_METHODS) {
      assert.equal(redirectedTo(await arriveAtAdmin({ method, action: true })), "/signin", `${method} was let through`);
    }
  });

  it("redirects a POST carrying no `next-action`", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin({ method: "POST" })), "/signin");
  });

  // The case the whole file exists for: let this one through and Next answers it by rendering the
  // admin layout into the action's response, which is the shell served to a caller with no session.
  it("turns a POST carrying `next-action` away to `/signin`, in the action's own redirect rather than a 307", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true });

    assert.equal(redirectedTo(answer), null, "a 307 is replayed by the action's fetch as a POST to the sign-in page");
    assert.equal(answer.headers.get("x-action-redirect"), "/signin;replace");
  });
});

describe("where the admin proxy sends a signed-in request", () => {
  // The case that proves the redirects above are the proxy's decision: a harness resolving no
  // session at all would redirect every one of them and read exactly the same.
  it("lets an allowlisted administrator through", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin({ token: ADMIN_TOKEN })), null);
  });

  it("lets that administrator's action POST through, whose answer has to be an RSC payload and not a redirect", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true, token: ADMIN_TOKEN });

    assert.equal(redirectedTo(answer), null);
    assert.equal(answer.headers.get("x-action-redirect"), null);
    assert.equal(answer.status, 200);
  });

  it("sends a session whose address has left the allowlist to the public root", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin({ token: REMOVED_TOKEN })), "/");
  });

  it("turns that session's action POST away to the public root as well, in the action's own redirect", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true, token: REMOVED_TOKEN });

    assert.equal(redirectedTo(answer), null);
    assert.equal(answer.headers.get("x-action-redirect"), "/;replace");
  });
});

/** The browser surface Next's action client touches while it loads and while it reads one answer. */
function browserGlobals(answer: Response): Record<string, unknown> {
  return {
    window: globalThis,
    location: new URL(ADMIN_URL),
    document: { documentElement: { dataset: {} } },
    addEventListener: () => {},
    // The development build of Next's vendored Flight client reads this at module scope.
    __webpack_require__: { u: () => "" },
    fetch: async () => answer,
  };
}

/** Runs Next's installed action client against one answer and reports where it left the router. */
async function dispatchAgainst(answer: Response): Promise<{ canonicalUrl: string; documentNavigation: boolean; rejection: unknown }> {
  const globals = browserGlobals(answer);
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, globals);

  try {
    const { serverActionReducer } = await import("next/dist/client/components/router-reducer/reducers/server-action-reducer.js");

    let rejection: unknown = null;
    const state = {
      canonicalUrl: new URL(ADMIN_URL).pathname,
      tree: ["", { children: ["__PAGE__", {}] }, null, null, true],
      nextUrl: null,
      previousNextUrl: null,
      pushRef: { pendingPush: false, mpaNavigation: false, preserveCustomHistoryState: true },
      renderedSearch: "",
      focusAndScrollRef: {},
      cache: null,
    } as unknown as Parameters<typeof serverActionReducer>[0];

    const next = await serverActionReducer(state, {
      type: "server-action",
      actionId: ACTION_ID.padEnd(42, "0"),
      actionArgs: [],
      resolve: () => {},
      reject: (reason: unknown) => {
        rejection = reason;
      },
    });

    return { canonicalUrl: next.canonicalUrl, documentNavigation: next.pushRef.mpaNavigation, rejection };
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
      else Object.defineProperty(globalThis, key, descriptor);
    }
  }
}

describe("what Next's own action client does with the proxy's answer to a signed-out action", () => {
  // The header is Next's rather than a documented contract, so this is what fails when an upgrade
  // stops reading it: the proxy cases above would still pass.
  it("leaves the editor for `/signin` on the answer the proxy gives", async () => {
    const outcome = await dispatchAgainst(await arriveAtAdmin({ method: "POST", action: true }));

    assert.equal(outcome.canonicalUrl, "/signin");
    assert.equal(outcome.documentNavigation, true);
    assert.match(String((outcome.rejection as Error | null)?.message), /^NEXT_REDIRECT/, "the awaiting save is not released as a redirect");
  });

  // Proves the case above can fail: the same client, handed the proxy's page redirect, throws.
  it("throws on the 307 a page request gets, which is why an action's POST never gets one", async () => {
    const outcome = await dispatchAgainst(await arriveAtAdmin({ method: "HEAD", action: true }));

    assert.equal(outcome.documentNavigation, false);
    assert.match(String((outcome.rejection as Error | null)?.message), /unexpected response/);
  });
});
