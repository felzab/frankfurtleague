import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADMIN_EMAIL,
  asDataUrl,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  memoryAdapterDouble,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
  signInByCode,
} from "./core/authDoubles.ts";
import { exportingModule } from "./core/exportingModule.ts";

const STORE = "__flProxyStore";
/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

/** The landing reads the request off this, where the proxy is handed its own `NextRequest`. */
const HEADERS_DOUBLE = exportingModule({ headers: () => Promise.resolve(requestHeaders) });

/** An address holding no grant, whose session the verdict is what refuses. */
const REMOVED_EMAIL = "ehemalig@example.org";

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
  core: { config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: {
    // This file's subject is the SHAPE of a turn-away rather than the store behind it.
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
    "next/headers": asDataUrl(HEADERS_DOUBLE),
    // Next's bundler aliases this to its own vendored copy, and no package of that name is installed.
    "react-server-dom-webpack/client": import.meta.resolve("next/dist/compiled/react-server-dom-webpack/client.js"),
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

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { NextRequest } = await import("next/server");
const { auth, getAdminSession, getSignInDestination } = await import("./core/auth.ts");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { config, proxy } = await import("./proxy.ts");

/** What the landing reads, for the cases that put its answer and this proxy's side by side. */
function arriveAs(cookie: string | null): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  const cookie = cookieHeader(await signInByCode(auth, email));

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

const ADMIN_URL = "http://localhost:3000/bereich/admin/spiele";

/** What react-dom fills the header with; the value is never read, only its presence. */
const ACTION_ID = "6f1b0c9d4a2e8f37";

/** Every method react-dom cannot be sending an action on, so each is a page request. */
const RENDERING_METHODS = ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];

type Arrival = { url?: string; method?: string; action?: boolean; cookie?: string };

async function arriveAtAdmin({ url = ADMIN_URL, method = "GET", action = false, cookie }: Arrival = {}): Promise<Response> {
  const headers = new Headers({ host: "localhost:3000" });
  if (action) headers.set("next-action", ACTION_ID);
  if (cookie !== undefined) headers.set("cookie", cookie);

  const answer = await proxy(new NextRequest(url, { method, headers }));

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
  it("lets an administrator holding a grant through", async () => {
    assert.equal(redirectedTo(await arriveAtAdmin({ cookie: admin.cookie })), null);
  });

  it("lets that administrator's action POST through, whose answer has to be an RSC payload and not a redirect", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true, cookie: admin.cookie });

    assert.equal(redirectedTo(answer), null);
    assert.equal(answer.headers.get("x-action-redirect"), null);
    assert.equal(answer.status, 200);
  });

  /* Optimistic, as Next documents a proxy's check: the session and its factor, and no backend read. The
     grant is the admin guard's, which refuses a session holding none on the same request. */
  it("lets a passkey session through whatever its grant, and leaves the grant to the admin guard", async (t) => {
    const fetched = t.mock.method(globalThis, "fetch", () => Promise.reject(new TypeError("fetch failed")));

    assert.equal(redirectedTo(await arriveAtAdmin({ cookie: removed.cookie })), null);
    assert.equal(fetched.mock.callCount(), 0, "the proxy asked the backend about a grant");

    arriveAs(removed.cookie);
    assert.equal(await getAdminSession(), null, "the guard admitted a session holding no grant");
  });

  it("lets that session's action POST through to the action's own guard", async () => {
    const answer = await arriveAtAdmin({ method: "POST", action: true, cookie: removed.cookie });

    assert.equal(redirectedTo(answer), null);
    assert.equal(answer.headers.get("x-action-redirect"), null);
  });

  /* The arm that made the public root wrong: an administrator who has typed the code and not yet
     used the passkey was dropped on a page offering neither the step nor a way back. */
  it("sends a code-borne administrator to the landing, which answers the passkey step for it", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    assert.equal(redirectedTo(await arriveAtAdmin({ cookie })), "/signin/weiter");

    arriveAs(cookie);
    assert.equal(await getSignInDestination(), "/signin/passkey", "the landing sends a code-borne administrator somewhere else");
  });

  /* The landing's `/bereich/admin` answer is the guard's own verdict, so a session it sends there is one the
     proxy lets through: the pair cannot bounce a caller between them. */
  it("sends nobody back to `/bereich/admin` that this proxy would turn away again", async () => {
    for (const { name, cookie } of [
      { name: "code-borne administrator", cookie: (await signIn(ADMIN_EMAIL)).cookie },
      { name: "address holding no grant", cookie: removed.cookie },
      { name: "no session at all", cookie: undefined },
    ]) {
      arriveAs(cookie ?? null);

      const landing = await getSignInDestination();
      const turned = redirectedTo(await arriveAtAdmin({ cookie }));

      assert.ok(landing !== "/bereich/admin" || turned === null, `${name} is bounced between the landing and the proxy`);
    }
  });
});

/**
 * Whether Next runs the proxy for `url`: its server tries the raw path and then its decoded spelling
 * (`next/dist/server/lib/router-utils/resolve-routes.js`), which the testing helper does not, so both are asked.
 */
function matched(url: string): boolean {
  const { pathname } = new URL(url);
  let spelled = pathname;
  try {
    spelled = decodeURIComponent(pathname);
  } catch {
    // Left as written, as Next leaves an escape it cannot decode.
  }

  return [pathname, spelled].some((path) => unstable_doesMiddlewareMatch({ config, url: new URL(path, url).href }));
}

describe("which addresses the admin proxy is run on", () => {
  // The person lane's words share the prefix and run no proxy: each person layout guards its own lane.
  it("runs on the administrator's subtree alone, its root and an escaped spelling included", () => {
    for (const url of [
      "http://localhost:3000/bereich/admin",
      "http://localhost:3000/bereich/admin/spiele",
      "http://localhost:3000/bereich/%61dmin/spiele",
    ]) {
      assert.equal(matched(url), true, `${url} runs no proxy`);
    }
    for (const url of [
      "http://localhost:3000/bereich",
      "http://localhost:3000/bereich/team/6890a1b2c3d4e5f607190001",
      "http://localhost:3000/bereich/administration",
      // A malformed escape the decoding cannot read, which must not take the request down with it.
      "http://localhost:3000/bereich/team/%E0%A4%A",
    ]) {
      assert.equal(matched(url), false, `${url} runs the administrator's proxy`);
    }
  });

  it("judges each spelling it runs on alike, turning a signed-out request away", async () => {
    for (const url of ["http://localhost:3000/bereich/admin", "http://localhost:3000/bereich/%61dmin/spiele"]) {
      assert.equal(redirectedTo(await arriveAtAdmin({ url })), "/signin", `${url} let a signed-out request through`);
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
