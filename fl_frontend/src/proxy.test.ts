import assert from "node:assert/strict";
import { describe, it } from "node:test";

// First, as Next's server loads it: its request stores take this global at their own load, and the
// adapter `visit` runs needs real ones.
import "next/dist/server/node-environment-baseline.js";

import {
  ADMIN_EMAIL,
  configDouble,
  GATE_BACKEND_CONFIG,
  HOLDS_NOTHING,
  madeByPasskey,
  memoryAdapterDouble,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
  sessionByCode,
} from "./core/authDoubles.ts";

import type { SessionRow } from "./core/authDoubles.ts";

const STORE = "__flProxyStore";
/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

/** The landing reads the request off this, where the proxy is handed its own `NextRequest`. */
const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

/** An address holding no grant, whose session the verdict is what refuses. */
const REMOVED_EMAIL = "ehemalig@example.org";

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
  core: { config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: {
    // This file's subject is the SHAPE of a turn-away rather than the store behind it.
    "@better-auth/mongo-adapter": memoryAdapterDouble(STORE),
    "next/headers": HEADERS_DOUBLE,
    // Next's bundler aliases this to its own vendored copy, and no package of that name is installed.
    "react-server-dom-webpack/client": import.meta.resolve("next/dist/compiled/react-server-dom-webpack/client.js"),
  },
});

const store = memoryStore(STORE);

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so neither the doubles nor the `next/server` extension would be in place yet.
const { NextRequest } = await import("next/server");
const { auth, getAdminSession, getKontoSession, getSignInDestination } = await import("./core/auth.ts");
const { getSubjectSession } = await import("./core/subject.ts");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { adapter } = await import("next/dist/server/web/adapter.js");
const { config, proxy } = await import("./proxy.ts");
const { EDGE_REFUSAL_BODY } = await import("./shared/utils/actionError.ts");

/** What the landing reads, for the cases that put its answer and this proxy's side by side. */
function arriveAs(cookie: string | null): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

const signIn = (email: string) => sessionByCode(auth, store, email);

const admin = await signIn(ADMIN_EMAIL);
// Stamped, because an administrator who has only followed the link is turned away by design and
// every "let through" case below would then pass for the wrong reason.
madeByPasskey(store, admin.row);

const removed = await signIn(REMOVED_EMAIL);
madeByPasskey(store, removed.row);

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

  /* `/bereich` sends a granted session the admin guard refuses on to `/bereich/admin`, so the landing's
     `/bereich` for one is the guard's own verdict: the pair cannot bounce a caller between them. */
  it("lands no granted session on `/bereich` that this proxy would turn away from `/bereich/admin`", async () => {
    for (const { name, cookie } of [
      { name: "code-borne administrator", cookie: (await signIn(ADMIN_EMAIL)).cookie },
      { name: "administrator signed in by passkey", cookie: admin.cookie },
    ]) {
      arriveAs(cookie);

      const landing = await getSignInDestination();
      const turned = redirectedTo(await arriveAtAdmin({ cookie }));

      assert.ok(landing !== "/bereich" || turned === null, `${name} is bounced between the landing and the proxy`);
    }

    arriveAs(admin.cookie);
    assert.equal(await getSignInDestination(), "/bereich", "the administrator was not landed on `/bereich`, so the case proves nothing");
  });
});

/**
 * Whether Next runs the proxy for `url`: its server tries the raw path and then its decoded spelling
 * (`next/dist/server/lib/router-utils/resolve-routes.js`), which the testing helper does not, so both are asked.
 */
function matched(
  url: string,
  { matcher = config.matcher, headers = {} }: { matcher?: typeof config.matcher; headers?: Record<string, string> } = {},
): boolean {
  const { pathname } = new URL(url);
  let spelled = pathname;
  try {
    spelled = decodeURIComponent(pathname);
  } catch {
    // Left as written, as Next leaves an escape it cannot decode.
  }

  return [pathname, spelled].some((path) =>
    // A copy each time: the helper writes a `host` into the object it is handed.
    unstable_doesMiddlewareMatch({ config: { matcher }, url: new URL(path, url).href, headers: { ...headers } }),
  );
}

/** What Next's router sends on a prefetch, which carries no page a person asked for. */
const PREFETCH = { "next-router-prefetch": "1" };

describe("which addresses the proxy is run on", () => {
  it("runs on every page a session serves, and on no public page or route handler", () => {
    for (const url of [
      "http://localhost:3000/bereich",
      "http://localhost:3000/bereich/konto",
      "http://localhost:3000/bereich/team/6890a1b2c3d4e5f607190001/2026",
      "http://localhost:3000/bereich/admin",
      "http://localhost:3000/bereich/%61dmin/spiele",
      "http://localhost:3000/signin",
      "http://localhost:3000/signin/weiter",
    ]) {
      assert.equal(matched(url), true, `${url} runs no proxy`);
    }
    // The route handlers write their own cookies, and a public page reads no session.
    for (const url of ["http://localhost:3000/", "http://localhost:3000/api/signin/code", "http://localhost:3000/api/admin/spiele/undo"]) {
      assert.equal(matched(url), false, `${url} runs the proxy`);
    }
  });

  // The administrator's subtree keeps its turn-away on a prefetch too, as it had with the admin entry alone.
  it("skips a prefetch everywhere but the administrator's subtree", () => {
    for (const url of ["http://localhost:3000/bereich/konto", "http://localhost:3000/signin"]) {
      assert.equal(matched(url, { headers: PREFETCH }), false, `${url} runs the proxy on a prefetch`);
    }
    assert.equal(matched("http://localhost:3000/bereich/admin/spiele", { headers: PREFETCH }), true);
  });

  /* The prefix test inside the proxy is a second reading of the admin entry: a spelling that entry
     admits and the test misses reaches the panel with the layout's guard alone. */
  it("judges exactly the spellings the administrator's own entry admits", async () => {
    // The first entry, which names the subtree and nothing else.
    const adminEntry = config.matcher.slice(0, 1);
    for (const url of [
      "http://localhost:3000/bereich/admin",
      "http://localhost:3000/bereich/admin/",
      "http://localhost:3000/bereich/admin/spiele",
      "http://localhost:3000/bereich/%61dmin/spiele",
      "http://localhost:3000/bereich/ADMIN/spiele",
      "http://localhost:3000/bereich//admin/spiele",
      "http://localhost:3000/bereich/administration",
      "http://localhost:3000/bereich/team/6890a1b2c3d4e5f607190001",
      // A malformed escape the decoding cannot read, which must not take the request down with it.
      "http://localhost:3000/bereich/team/%E0%A4%A",
    ]) {
      const judged = redirectedTo(await arriveAtAdmin({ url })) === "/signin";
      assert.equal(judged, matched(url, { matcher: adminEntry }), `${url} is judged otherwise than the admin entry matches it`);
    }
  });

  // The person lane's words share the prefix, and the administrator's checks would turn every person away.
  it("lets every page outside the administrator's subtree through, whoever arrives", async () => {
    for (const url of ["http://localhost:3000/bereich/konto", "http://localhost:3000/bereich/administration", "http://localhost:3000/signin"]) {
      for (const cookie of [undefined, removed.cookie]) {
        const answer = await arriveAtAdmin({ url, cookie });

        assert.equal(answer.headers.get("x-middleware-next"), "1", `${url} was judged by the administrator's checks`);
      }
    }
  });
});

const EXPIRES_IN_MS = (auth.options.session?.expiresIn ?? Number.NaN) * 1000;
const UPDATE_AGE_MS = (auth.options.session?.updateAge ?? Number.NaN) * 1000;
const MINUTE_MS = 60 * 1000;

const PERSON_URL = "http://localhost:3000/bereich/konto";

/** Leaves `row` as the library's own refresh `ago` milliseconds back would have left it. */
function refreshedAgo(row: SessionRow, ago: number): void {
  row.updatedAt = new Date(Date.now() - ago);
  row.expiresAt = new Date(row.updatedAt.getTime() + EXPIRES_IN_MS);
}

/**
 * The proxy as Next's server runs it, through Next's own adapter: a direct call shows neither the
 * router's headers stripped from what `nextCookies()` reads nor the cookie it sets landing on the answer.
 */
async function visit(url: string, cookie: string | undefined, load: "document" | "navigation" = "navigation"): Promise<Response> {
  const headers: Record<string, string> = { host: "localhost:3000" };
  // What the router sends on a client navigation: a render reading these skips the refresh.
  if (load === "navigation") Object.assign(headers, { rsc: "1", "next-router-state-tree": "%5B%22%22%5D" });
  if (cookie !== undefined) headers.cookie = cookie;

  const { response } = await adapter({
    handler: proxy,
    page: "/src/proxy",
    request: { url, method: "GET", headers, nextConfig: {}, signal: new AbortController().signal },
  });
  return response;
}

/** The session cookie an answer sets: its value and its `Max-Age` in seconds, or `undefined` where it sets none. */
function setSessionCookie(answer: Response, held: string): { value: string; maxAge: number } | undefined {
  const [name] = held.split("=");
  const line = answer.headers.getSetCookie().find((set) => set.startsWith(`${name}=`));
  if (line === undefined) return undefined;

  const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
  const maxAge = attributes.find((attribute) => /^max-age=/i.test(attribute))?.split("=")[1];
  return { value: decodeURIComponent(pair.slice(`${name}=`.length)), maxAge: Number(maxAge) };
}

const heldValue = (cookie: string): string => decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1).split(";")[0] ?? "");

/** The stamps that say when a row was last used and when it lapses. */
const stampsOf = (row: SessionRow) => ({ updatedAt: row.updatedAt.getTime(), expiresAt: row.expiresAt.getTime() });

describe("where a session that is only read slides (`docs/frontend/spec.md :: I495`)", () => {
  it("slides a person's row and cookie once past `updateAge`, on a document load and a client navigation alike", async () => {
    for (const load of ["document", "navigation"] as const) {
      const { cookie, row } = await signIn("leserin@example.org");
      refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
      const before = Date.now();

      const set = setSessionCookie(await visit(PERSON_URL, cookie, load), cookie);

      assert.ok(row.updatedAt.getTime() >= before, `a ${load} left the row's use where it was`);
      assert.ok(row.expiresAt.getTime() >= before + EXPIRES_IN_MS, `a ${load} left the row's expiry where it was`);
      assert.deepEqual(set, { value: heldValue(cookie), maxAge: EXPIRES_IN_MS / 1000 }, `a ${load} slid the row and not the cookie`);
    }
  });

  it("writes neither a minute short of `updateAge`, nor a second time inside it", async () => {
    const { cookie, row } = await signIn("leserin@example.org");

    refreshedAgo(row, UPDATE_AGE_MS - MINUTE_MS);
    const early = stampsOf(row);
    assert.equal(setSessionCookie(await visit(PERSON_URL, cookie), cookie), undefined);
    assert.deepEqual(stampsOf(row), early, "a read inside `updateAge` wrote the row");

    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    assert.ok(
      setSessionCookie(await visit(PERSON_URL, cookie), cookie),
      "the read past `updateAge` slid nothing, so the case below proves nothing",
    );
    const slid = stampsOf(row);
    assert.equal(setSessionCookie(await visit(PERSON_URL, cookie), cookie), undefined);
    assert.deepEqual(stampsOf(row), slid, "the next read wrote the row again");
  });

  // Written there, the row would outlive the cookie the browser holds, which no later read inside `updateAge` repairs.
  it("never slides a session a page render reads, which could not carry the cookie", async () => {
    const { cookie, row } = await signIn("leserin@example.org");
    // Past the window a passkey is offered in, so the landing asks the plugin nothing.
    row.createdAt = new Date(Date.now() - 24 * 60 * MINUTE_MS);
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    const due = stampsOf(row);

    arriveAs(cookie);
    assert.equal(await getSignInDestination(), "/bereich", "the render read no live session, so the case proves nothing");

    assert.deepEqual(stampsOf(row), due);
  });

  // The cookie is expired rather than left standing: the library clears it on a read that finds no live row.
  it("revives no ended session: no row is written, and the cookie is expired", async () => {
    for (const ending of ["deleted", "lapsed"] as const) {
      const { cookie, row } = await signIn("leserin@example.org");
      if (ending === "deleted") store.session.splice(store.session.indexOf(row), 1);
      else row.expiresAt = new Date(Date.now() - MINUTE_MS);

      const set = setSessionCookie(await visit(PERSON_URL, cookie), cookie);

      assert.equal(
        store.session.some(({ token }) => token === row.token),
        false,
        `a ${ending} session has a row again`,
      );
      assert.equal(set?.maxAge, 0, `a ${ending} session's cookie was left standing or extended`);
    }
  });

  // The slide reads no ban, which is the backend's: what keeps a barred session out is every guard's own read.
  it("leaves a barred person refused by the landing, the person guard and the account guard once their session slid", async (t) => {
    const { cookie, row } = await signIn("gesperrt@example.org");
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    t.mock.method(globalThis, "fetch", () => Promise.resolve(Response.json({ ...HOLDS_NOTHING, gesperrt: true })));

    assert.ok(setSessionCookie(await visit(PERSON_URL, cookie), cookie), "nothing slid, so the case proves nothing");

    arriveAs(cookie);
    assert.equal(await getSignInDestination(), "/signin");
    assert.equal(await getSubjectSession(), null);
    assert.equal(await getKontoSession(), null);
  });

  it("leaves an administrator's forty-eight-hour cap, and the step-up window, where the sign-in set them", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    const signedIn = new Date(Date.now() - 49 * 60 * MINUTE_MS);
    row.createdAt = signedIn;
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);

    const answer = await visit(ADMIN_URL, cookie);

    assert.ok(setSessionCookie(answer, cookie), "the administrator's session did not slide, so the case proves nothing");
    assert.equal(row.createdAt.getTime(), signedIn.getTime(), "the slide moved the stamp both the cap and the step-up are judged from");
    arriveAs(cookie);
    assert.equal(await getAdminSession(), null, "a slid session outlived the administrator's cap");
  });
});

/** The browser surface Next's action client touches while it loads and while it reads one answer. */
function browserGlobals(answer: Response): Record<string, unknown> {
  return {
    window: globalThis,
    location: new URL(ADMIN_URL),
    document: { documentElement: { dataset: {}, removeAttribute: () => {} } },
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

describe("what Next's own action client does with the edge's own 429", () => {
  // The frontend's answer to a press the edge refused rests on this reading
  // (`fl_frontend/src/shared/utils/actionError.ts :: EDGE_REFUSAL_BODY`): an upgrade dropping it fails here.
  it("rejects the awaiting action with the body as its message, under exactly `text/plain`", async () => {
    const outcome = await dispatchAgainst(new Response(EDGE_REFUSAL_BODY, { status: 429, headers: { "content-type": "text/plain" } }));

    assert.equal(outcome.documentNavigation, false);
    assert.equal((outcome.rejection as Error | null)?.message, EDGE_REFUSAL_BODY);
  });

  // Proves the case above can fail, and why the edge sends no charset: Next compares the type whole.
  it("reads the same body as its generic failure once a charset rides on the type", async () => {
    const outcome = await dispatchAgainst(
      new Response(EDGE_REFUSAL_BODY, { status: 429, headers: { "content-type": "text/plain; charset=utf-8" } }),
    );

    assert.match(String((outcome.rejection as Error | null)?.message), /unexpected response/);
  });
});
