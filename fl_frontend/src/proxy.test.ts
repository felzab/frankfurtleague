import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { after, describe, it } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const STORE = "__flProxyStore";
const REQUEST_HEADERS = "__flProxyRequestHeaders";

/** A single-segment subpath such as `next/server`, leaving a deep `next/dist/…` path to Node. */
const NEXT_SUBPATH = /^next\/[\w-]+$/;

/** The landing reads the request off this, where the proxy is handed its own `NextRequest`. */
const HEADERS_DOUBLE = `export const headers = async () => globalThis.${REQUEST_HEADERS};`;

const ADMIN_EMAIL = "vorstand@example.org";
/** An address the allowlist below does not carry, whose session the verdict is what refuses. */
const REMOVED_EMAIL = "ehemalig@example.org";

const CONFIG_DOUBLE = `export const frontend_config = {
  ALLOWED_ADMIN_EMAILS: ["${ADMIN_EMAIL}"],
  AUTH_URL: "http://localhost:3000",
  AUTH_SECRET: "fabricated-test-secret-not-a-credential",
  LOG_LEVEL: "ERROR",
  LOG_FORMAT: "json",
};`;

// Replaced at the module boundary rather than the adapter being given a seam: the real module opens
// a `MongoClient` at import, so loading it would reach for a server no test run holds.
const DB_DOUBLE = `export const client = { db: () => ({}) };`;

const MAIL_DOUBLE = `export const sendMail = async () => ({ id: null });`;

/* The Mongo adapter reaches a real server through aggregation pipelines, and this file's subject is
   the SHAPE of a turn-away rather than the store behind it. */
const adapterDouble = (memoryAdapterUrl: string) => `import { memoryAdapter } from ${JSON.stringify(memoryAdapterUrl)};
export const mongodbAdapter = () => memoryAdapter(globalThis.${STORE});`;

const MEMORY_ADAPTER_URL = import.meta.resolve("better-auth/adapters/memory");

const asDataUrl = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    if (specifier === "@better-auth/mongo-adapter") return { url: asDataUrl(adapterDouble(MEMORY_ADAPTER_URL)), shortCircuit: true };
    if (specifier === "next/headers") return { url: asDataUrl(HEADERS_DOUBLE), shortCircuit: true };
    // `next` publishes no `exports` map, so Node's resolver has no subpath to consult and only a file
    // path resolves. Both the library and the application import these bare.
    if (NEXT_SUBPATH.test(specifier)) return nextResolve(`${specifier}.js`, context);
    // Next's bundler aliases this to its own vendored copy, and no package of that name is installed.
    if (specifier === "react-server-dom-webpack/client") return nextResolve("next/dist/compiled/react-server-dom-webpack/client.js", context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/db.ts")) return { format: "module", source: DB_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/mail.ts")) return { format: "module", source: MAIL_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

type SessionRow = { token: string; userId: string; authFactor?: string };

type Store = {
  user: unknown[];
  session: SessionRow[];
  account: unknown[];
  verification: { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date; updatedAt: Date }[];
  passkey: unknown[];
};

const store: Store = { user: [], session: [], account: [], verification: [], passkey: [] };
(globalThis as unknown as Record<string, unknown>)[STORE] = store;

// The library reads this name natively where no `secret` option is passed; the option comes from the
// config double above, and this keeps a real environment out of the run either way.
const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "fabricated-test-secret-not-a-credential";
after(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { NextRequest } = await import("next/server");
const { auth, getSignInDestination } = await import("./core/auth.ts");
const { proxy } = await import("./proxy.ts");

const ORIGIN = { host: "localhost:3000", "x-forwarded-proto": "http" };

/** What the landing reads, for the cases that put its answer and this proxy's side by side. */
function arriveAs(cookie: string | null): void {
  (globalThis as unknown as Record<string, unknown>)[REQUEST_HEADERS] = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

/* Seeded at the shape the plugin stores — SHA-256, base64url, no padding — because verification is
   what mints a session and it gates on no allowlist. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  const token = `fabricated-link-${randomUUID()}`;

  store.verification.push({
    id: randomUUID(),
    identifier: createHash("sha256").update(token).digest("base64url"),
    value: JSON.stringify({ email }),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const verified = await auth.api.magicLinkVerify({ query: { token }, headers: new Headers(ORIGIN), returnHeaders: true });
  const cookie = verified.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");

  return { cookie, row };
}

const admin = await signIn(ADMIN_EMAIL);
// Stamped, because an administrator who has only followed the link is turned away by design and
// every "let through" case below would then pass for the wrong reason.
admin.row.authFactor = "passkey";

const removed = await signIn(REMOVED_EMAIL);
removed.row.authFactor = "passkey";

const ADMIN_URL = "http://localhost:3000/admin/spiele";

/** What react-dom fills the header with; the value is never read, only its presence. */
const ACTION_ID = "6f1b0c9d4a2e8f37";

/** Every method react-dom cannot be sending an action on, so each is a page request. */
const RENDERING_METHODS = ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];

type Arrival = { method?: string; action?: boolean; cookie?: string };

async function arriveAtAdmin({ method = "GET", action = false, cookie }: Arrival = {}): Promise<Response> {
  const headers = new Headers({ host: "localhost:3000" });
  if (action) headers.set("next-action", ACTION_ID);
  if (cookie !== undefined) headers.set("cookie", cookie);

  const answer = await proxy(new NextRequest(ADMIN_URL, { method, headers }));

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
    assert.equal(redirectedTo(await arriveAtAdmin({ cookie: admin.cookie })), null);
  });

  it("lets that administrator's action POST through, whose answer has to be an RSC payload and not a redirect", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true, cookie: admin.cookie });

    assert.equal(redirectedTo(answer), null);
    assert.equal(answer.headers.get("x-action-redirect"), null);
    assert.equal(answer.status, 200);
  });

  /* To the landing and never the public root: the landing is the one place that decides, and it
     sends a removed address to `/` while sending the administrator below one step further on. */
  it("sends a session whose address has left the allowlist to the landing", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin({ cookie: removed.cookie })), "/signin/weiter");
  });

  it("turns that session's action POST away to the landing as well, in the action's own redirect", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true, cookie: removed.cookie });

    assert.equal(redirectedTo(answer), null);
    assert.equal(answer.headers.get("x-action-redirect"), "/signin/weiter;replace");
  });

  /* The arm that made the public root wrong: an administrator who has followed the link and not yet
     used the passkey was dropped on a page offering neither the step nor a way back. */
  it("sends a link-borne administrator to the landing, which answers the passkey step for it", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    assert.equal(redirectedTo(await arriveAtAdmin({ cookie })), "/signin/weiter");

    arriveAs(cookie);
    assert.equal(await getSignInDestination(), "/signin/passkey", "the landing sends a link-borne administrator somewhere else");
  });

  /* The landing's `/admin` answer is the guard's own verdict, so a session it sends there is one the
     proxy lets through: the pair cannot bounce a caller between them. */
  it("sends nobody back to `/admin` that this proxy would turn away again", async () => {
    for (const { name, cookie } of [
      { name: "link-borne administrator", cookie: (await signIn(ADMIN_EMAIL)).cookie },
      { name: "address outside the allowlist", cookie: removed.cookie },
      { name: "no session at all", cookie: undefined },
    ]) {
      arriveAs(cookie ?? null);

      const landing = await getSignInDestination();
      const turned = redirectedTo(await arriveAtAdmin({ cookie }));

      assert.ok(landing !== "/admin" || turned === null, `${name} is bounced between the landing and the proxy`);
    }
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

/**
 * Runs Next's installed action client against one answer and reports where it left the router.
 *
 * A probe of a PRIVATE path, bought for what no assertion over the proxy's own answer shows: that
 * the header is read at all.
 */
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
