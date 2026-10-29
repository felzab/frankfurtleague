// First, as Next's server loads it: its request stores take this global at their own load, and the
// adapter `visit` runs needs real ones.
import { assert, describe, expect, it, vi } from "vitest";

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
} from "@/test-support/authDoubles.ts";

import type { SessionRow } from "@/test-support/authDoubles.ts";

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
  },
});

const store = memoryStore(STORE);

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { NextRequest } = await import("next/server");
const { auth, getAdminSession, getKontoSession, getSignInDestination } = await import("./core/auth.ts");
const { getSubjectSession } = await import("./core/subject.ts");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { adapter } = await import("next/dist/server/web/adapter.js");
const { config, proxy } = await import("./proxy.ts");
const { SIGN_IN_LANDING } = await import("./core/signInLanding.ts");
const { requireAdminRequest } = await import("./shared/utils/adminRead.ts");

/** What the landing reads, for the cases that put its answer and this proxy's side by side. */
function arriveAs(cookie: string | null): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

const signIn = (email: string) => sessionByCode(auth, store, email);

const admin = await signIn(ADMIN_EMAIL);
// Stamped, because the admin guard turns away an administrator who has only followed the link, so a case
// below reading its verdict on the grant would then pass for the wrong reason.
madeByPasskey(store, admin.row);

const removed = await signIn(REMOVED_EMAIL);
madeByPasskey(store, removed.row);

const ADMIN_URL = "http://localhost:3000/bereich/admin/spiele";

/** What react-dom fills the header with; the value is never read, only its presence. */
const ACTION_ID = "6f1b0c9d4a2e8f37";

/** Every method react-dom cannot be sending an action on, so each is a page request. */
const RENDERING_METHODS = ["HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];

type Arrival = { url?: string; method?: string; action?: boolean; cookie?: string };

/** The proxy's own answer, called directly: the administrator's subtree unless `url` names another page. */
async function callProxy({ url = ADMIN_URL, method = "GET", action = false, cookie }: Arrival = {}): Promise<Response> {
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

describe("where the proxy sends a request for the administrator's subtree carrying no session cookie", () => {
  it("redirects a plain page request", async () => {
    expect(redirectedTo(await callProxy())).toBe("/signin");
  });

  it("redirects a GET carrying `next-action`, which Next reads as a page render rather than an action", async () => {
    expect(redirectedTo(await callProxy({ action: true }))).toBe("/signin");
  });

  it("redirects every other method carrying `next-action`", async () => {
    for (const method of RENDERING_METHODS) {
      expect(redirectedTo(await callProxy({ method, action: true })), `${method} was let through`).toBe("/signin");
    }
  });

  it("redirects a POST carrying no `next-action`", async () => {
    expect(redirectedTo(await callProxy({ method: "POST" }))).toBe("/signin");
  });

  // The case this block exists for: let this one through and Next answers it by rendering the
  // admin layout into the action's response, which is the shell served to a caller with no session.
  it("turns a POST carrying `next-action` away to `/signin`, in the action's own redirect rather than a 307", async () => {
    const answer = await callProxy({ method: "POST", action: true });

    expect(redirectedTo(answer), "a 307 is replayed by the action's fetch as a POST to the sign-in page").toBe(null);
    expect(answer.headers.get("x-action-redirect")).toBe("/signin;replace");
  });
});

describe("where the proxy sends a request for the administrator's subtree carrying a session cookie", () => {
  // The control for the redirects above: a proxy turning every request away would read exactly the
  // same there.
  it("lets an administrator holding a grant through", async () => {
    expect(redirectedTo(await callProxy({ cookie: admin.cookie }))).toBe(null);
  });

  it("lets that administrator's action POST through, whose answer has to be an RSC payload and not a redirect", async () => {
    const answer = await callProxy({ method: "POST", action: true, cookie: admin.cookie });

    expect(redirectedTo(answer)).toBe(null);
    expect(answer.headers.get("x-action-redirect")).toBe(null);
    expect(answer.status).toBe(200);
  });

  /* Optimistic, as Next and the library document a proxy's check: the cookie alone, and no backend read.
     The grant is the admin guard's, which refuses a session holding none on the same request. */
  it("lets a passkey session through whatever its grant, and leaves the grant to the admin guard", async ({ onTestFinished }) => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    onTestFinished(() => void fetched.mockRestore());

    expect(redirectedTo(await callProxy({ cookie: removed.cookie }))).toBe(null);
    expect(fetched.mock.calls.length, "the proxy asked the backend about a grant").toBe(0);

    arriveAs(removed.cookie);
    expect(await getAdminSession(), "the guard admitted a session holding no grant").toBe(null);
  });

  it("lets that session's action POST through to the action's own guard", async () => {
    const answer = await callProxy({ method: "POST", action: true, cookie: removed.cookie });

    expect(redirectedTo(answer)).toBe(null);
    expect(answer.headers.get("x-action-redirect")).toBe(null);
  });

  /* The factor is the guard's, read where the data is: the landing then answers the passkey step, where the
     public root would offer an administrator who has typed the code neither the step nor a way back. */
  it("lets a code-borne administrator through to the guard, which sends it to the landing's passkey step", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    expect((await callProxy({ cookie })).headers.get("x-middleware-next"), "the proxy judged the session's factor").toBe("1");

    arriveAs(cookie);
    await expect(requireAdminRequest()).rejects.toSatisfy(
      (error: { digest?: unknown }) => error.digest === `NEXT_REDIRECT;replace;${SIGN_IN_LANDING};307;`,
    );
    expect(await getSignInDestination(), "the landing sends a code-borne administrator somewhere else").toBe("/signin/passkey");
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

  // Handed over as the helper's own `cookies`: it writes that header from them whatever `headers` carried.
  const { cookie = "", ...rest } = headers;
  const cookies = Object.fromEntries(cookie.split(";").flatMap((pair) => (pair.includes("=") ? [pair.trim().split(/=(.*)/s, 2)] : [])));

  return [pathname, spelled].some((path) =>
    // A copy each time: the helper writes a `host` into the object it is handed.
    unstable_doesMiddlewareMatch({ config: { matcher }, url: new URL(path, url).href, headers: { ...rest }, cookies }),
  );
}

/**
 * What Next's router sends on a prefetch, a partial one's `2` and `3` among them, and what a browser's own sends,
 * none carrying a page a person asked for (`next/dist/client/components/segment-cache/cache.js`).
 */
const PREFETCHES: Record<string, string>[] = [
  { "next-router-prefetch": "1" },
  { "next-router-prefetch": "2" },
  { "next-router-prefetch": "3" },
  { purpose: "prefetch" },
];

const TEAM_URL = "http://localhost:3000/bereich/team/6890a1b2c3d4e5f607190001/2526";

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
      expect(matched(url), `${url} runs no proxy`).toBe(true);
    }
    // The route handlers write their own cookies, and a public page reads no session.
    for (const url of ["http://localhost:3000/", "http://localhost:3000/api/signin/code", "http://localhost:3000/api/bestaetigung/kontakt"]) {
      expect(matched(url), `${url} runs the proxy`).toBe(false);
    }
  });

  /* Next strips the prefetch header before the proxy runs, so a prefetch reaching it carrying a session would
     slide it, a store read for a page nobody asked for. */
  it("skips a prefetch carrying a session cookie everywhere, the administrator's subtree included", async () => {
    const { cookie } = await signIn("leserin@example.org");
    for (const prefetch of PREFETCHES) {
      for (const url of [
        "http://localhost:3000/bereich",
        "http://localhost:3000/bereich/konto",
        TEAM_URL,
        "http://localhost:3000/signin",
        ADMIN_URL,
        "http://localhost:3000/bereich/%61dmin/spiele",
      ]) {
        expect(
          matched(url, { headers: { ...prefetch, cookie } }),
          `${url} runs the proxy on a signed-in prefetch, ${JSON.stringify(prefetch)}`,
        ).toBe(false);
      }
    }
  });

  /* The cookie alone answers it, before any read: a visitor holding none is sent to sign in rather than
     shown the area's prefetched frame. A sign-in page's prefetch reads nothing either way. */
  it("runs on a prefetch of an area's page carrying no session cookie, and of no sign-in page", () => {
    for (const prefetch of PREFETCHES) {
      for (const url of ["http://localhost:3000/bereich", "http://localhost:3000/bereich/konto", TEAM_URL, ADMIN_URL]) {
        expect(
          matched(url, { headers: { ...prefetch, cookie: "theme=dark" } }),
          `${url} skips a signed-out prefetch, ${JSON.stringify(prefetch)}`,
        ).toBe(true);
      }
      expect(matched("http://localhost:3000/signin", { headers: prefetch })).toBe(false);
    }
  });

  /* The proxy's prefix test is a second reading of the area's entry: a spelling that entry admits and the
     test misses reaches a page past the cookie check, judged by its guard alone after the frame painted. */
  it("turns a request carrying no session cookie away on exactly the spellings the area's own entry admits", async () => {
    // The first entry, which names the area and nothing else.
    const areaEntry = config.matcher.slice(0, 1);
    for (const url of [
      "http://localhost:3000/bereich",
      "http://localhost:3000/bereich/",
      "http://localhost:3000/bereich/admin/spiele",
      "http://localhost:3000/bereich/%61dmin/spiele",
      "http://localhost:3000/%62ereich/konto",
      "http://localhost:3000/BEREICH/konto",
      "http://localhost:3000/bereichsweise",
      "http://localhost:3000/signin",
      // A malformed escape the decoding cannot read, which must not take the request down with it.
      "http://localhost:3000/bereich/team/%E0%A4%A",
    ]) {
      const judged = redirectedTo(await callProxy({ url })) === "/signin";
      expect(judged, `${url} is judged otherwise than the area's entry matches it`).toBe(matched(url, { matcher: areaEntry }));
    }
  });

  // The verdicts past the cookie are each guard's, read where the data is.
  it("lets every session carrying a cookie through, the administrator's subtree included, a grant held or none", async () => {
    for (const url of [
      "http://localhost:3000/bereich/konto",
      "http://localhost:3000/bereich/administration",
      "http://localhost:3000/signin",
      ADMIN_URL,
    ]) {
      for (const cookie of [(await signIn("leserin@example.org")).cookie, removed.cookie]) {
        const answer = await callProxy({ url, cookie });

        expect(answer.headers.get("x-middleware-next"), `${url} was judged past the cookie`).toBe("1");
      }
    }
  });

  // The sign-in's own pages are where a visitor holding no session is sent, so they turn nobody away.
  it("lets every sign-in page through with no session", async () => {
    for (const url of ["http://localhost:3000/signin", "http://localhost:3000/signin/weiter"]) {
      expect((await callProxy({ url })).headers.get("x-middleware-next"), `${url} turned a visitor away`).toBe("1");
    }
  });
});

const PERSON_URLS = [
  "http://localhost:3000/bereich",
  "http://localhost:3000/bereich/konto",
  "http://localhost:3000/bereich/zorbanax",
  TEAM_URL,
];

describe("where the proxy sends a request for an area's page", () => {
  /* Optimistic, as Next and the library document a proxy's check: turned away before any bar paints, where
     the page's own guard would turn it away only once the area's frame had streamed. */
  it("sends a request carrying no session cookie to sign in, reading no store, the administrator's subtree included", async ({
    onTestFinished,
  }) => {
    const read = vi.spyOn(auth.api, "getSession");
    onTestFinished(() => void read.mockRestore());
    for (const url of [...PERSON_URLS, ADMIN_URL, "http://localhost:3000/bereich/%61dmin/spiele"]) {
      expect(redirectedTo(await callProxy({ url })), `${url} let a visitor holding no session through`).toBe("/signin");
    }
    expect(read.mock.calls.length, "the cookie check read the store").toBe(0);
  });

  // An action's POST takes the same turn-away in the header its client reads, never the 307 its `fetch` would
  // replay.
  it("turns a signed-out action's POST away in the action's own redirect", async () => {
    for (const url of PERSON_URLS) {
      const answer = await callProxy({ url, method: "POST", action: true });

      expect(answer.headers.get("x-action-redirect"), `${url} answered a signed-out action otherwise`).toBe("/signin;replace");
    }
  });

  /* The cookie is no session, and the slide's answer decides nothing: the library expires the cookie on the
     slide's read, and the page's guard, reading the session it serves, turns the visitor away. */
  it("lets a cookie whose session is gone through, expired, to the guard that turns it away", async () => {
    const administrator = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, administrator.row);

    for (const [name, { cookie, row }] of [
      ["person", await signIn("leserin@example.org")],
      ["administrator", administrator],
    ] as const) {
      store.session.splice(store.session.indexOf(row), 1);

      for (const url of [...PERSON_URLS, ADMIN_URL]) {
        const answer = await visit(url, cookie, "document");

        expect(answer.headers.get("location"), `${url} turned a ${name}'s cookie away on the slide's answer`).toBe(null);
        expect(setSessionCookie(answer, cookie)?.maxAge, `${url} left a ${name}'s ended cookie standing`).toBe(0);
      }

      // A person's guard reads no session, which every person page sends to sign in; the administrator's
      // sends it to the landing.
      arriveAs(cookie);
      expect(await getSubjectSession(), `the person guard served a ${name}'s ended session`).toBe(null);
      await expect(requireAdminRequest()).rejects.toSatisfy(
        (error: { digest?: unknown }) => error.digest === `NEXT_REDIRECT;replace;${SIGN_IN_LANDING};307;`,
      );
    }
  });

  // The control: a live session, code-borne and holding no grant, reaches every one of these pages.
  it("lets a person's live session through", async () => {
    const { cookie } = await signIn("leserin@example.org");

    for (const url of PERSON_URLS) {
      expect((await callProxy({ url, cookie })).headers.get("x-middleware-next"), `${url} turned a live session away`).toBe("1");
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
  // What the router sends on a client navigation, which the proxy slides on too. A render's read refreshes
  // nothing whatever these say: it passes `disableRefresh` (`fl_frontend/src/core/auth.ts :: readServedSession`).
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

describe("where a session that is only read slides", () => {
  it("slides a person's row and cookie once past `updateAge`, on a document load and a client navigation alike", async () => {
    for (const load of ["document", "navigation"] as const) {
      const { cookie, row } = await signIn("leserin@example.org");
      refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
      const before = Date.now();

      const set = setSessionCookie(await visit(PERSON_URL, cookie, load), cookie);

      assert.ok(row.updatedAt.getTime() >= before, `a ${load} left the row's use where it was`);
      assert.ok(row.expiresAt.getTime() >= before + EXPIRES_IN_MS, `a ${load} left the row's expiry where it was`);
      expect(set, `a ${load} slid the row and not the cookie`).toStrictEqual({ value: heldValue(cookie), maxAge: EXPIRES_IN_MS / 1000 });
    }
  });

  it("writes neither a minute short of `updateAge`, nor a second time inside it", async () => {
    const { cookie, row } = await signIn("leserin@example.org");

    refreshedAgo(row, UPDATE_AGE_MS - MINUTE_MS);
    const early = stampsOf(row);
    expect(setSessionCookie(await visit(PERSON_URL, cookie), cookie)).toBe(undefined);
    expect(stampsOf(row), "a read inside `updateAge` wrote the row").toStrictEqual(early);

    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    assert.ok(
      setSessionCookie(await visit(PERSON_URL, cookie), cookie),
      "the read past `updateAge` slid nothing, so the case below proves nothing",
    );
    const slid = stampsOf(row);
    expect(setSessionCookie(await visit(PERSON_URL, cookie), cookie)).toBe(undefined);
    expect(stampsOf(row), "the next read wrote the row again").toStrictEqual(slid);
  });

  // Written there, the row would outlive the cookie the browser holds, which no later read inside `updateAge` repairs.
  it("never slides a session a page render reads, which could not carry the cookie", async () => {
    const { cookie, row } = await signIn("leserin@example.org");
    // Past the window a passkey is offered in, so the landing asks the plugin nothing.
    row.createdAt = new Date(Date.now() - 24 * 60 * MINUTE_MS);
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    const due = stampsOf(row);

    arriveAs(cookie);
    expect(await getSignInDestination(), "the render read no live session, so the case proves nothing").toBe("/bereich");

    expect(stampsOf(row)).toStrictEqual(due);
  });

  // The cookie is expired rather than left standing: the library clears it on a read that finds no live row.
  it("revives no ended session: no row is written, and the cookie is expired", async () => {
    for (const ending of ["deleted", "lapsed"] as const) {
      const { cookie, row } = await signIn("leserin@example.org");
      if (ending === "deleted") store.session.splice(store.session.indexOf(row), 1);
      else row.expiresAt = new Date(Date.now() - MINUTE_MS);

      const set = setSessionCookie(await visit(PERSON_URL, cookie), cookie);

      expect(
        store.session.some(({ token }) => token === row.token),
        `a ${ending} session has a row again`,
      ).toBe(false);
      expect(set?.maxAge, `a ${ending} session's cookie was left standing or extended`).toBe(0);
    }
  });

  // The slide reads no ban, which is the backend's: what keeps a barred session out is every guard's own read.
  it("leaves a barred person refused by the landing, the person guard and the account guard once their session slid", async ({
    onTestFinished,
  }) => {
    const { cookie, row } = await signIn("gesperrt@example.org");
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    const fetched = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json({ ...HOLDS_NOTHING, gesperrt: true })));
    onTestFinished(() => void fetched.mockRestore());

    assert.ok(setSessionCookie(await visit(PERSON_URL, cookie), cookie), "nothing slid, so the case proves nothing");

    arriveAs(cookie);
    expect(await getSignInDestination()).toBe("/signin");
    expect(await getSubjectSession()).toBe(null);
    expect(await getKontoSession()).toBe(null);
  });

  it("leaves an administrator's twenty-four-hour cap, and the step-up window, where the sign-in set them", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    madeByPasskey(store, row);
    const signedIn = new Date(Date.now() - 25 * 60 * MINUTE_MS);
    row.createdAt = signedIn;
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);

    const answer = await visit(ADMIN_URL, cookie);

    assert.ok(setSessionCookie(answer, cookie), "the administrator's session did not slide, so the case proves nothing");
    expect(row.createdAt.getTime(), "the slide moved the stamp both the cap and the step-up are judged from").toBe(signedIn.getTime());
    arriveAs(cookie);
    expect(await getAdminSession(), "a slid session outlived the administrator's cap").toBe(null);
  });
});
