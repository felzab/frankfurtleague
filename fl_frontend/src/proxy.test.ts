// First, as Next's server loads it: its request stores take this global at their own load, and the
// adapter `visit` runs needs real ones.
import { assert, describe, expect, it, vi } from "vitest";

import "next/dist/server/node-environment-baseline.js";

import {
  ADMIN_EMAIL,
  configDouble,
  cookiePair,
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
const { auth } = await import("./core/auth/library.ts");
const { getAdminSession, getAccountSession } = await import("./core/auth/guards.ts");
const { getSignInLanding } = await import("./core/auth/landing.ts");
const { getSubjectSession } = await import("./core/subject.ts");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { adapter } = await import("next/dist/server/web/adapter.js");
const { config, proxy } = await import("./proxy.ts");
const { ROUTES } = await import("./core/routes.ts");
const { requireAdminRequest } = await import("./shared/utils/adminRead.ts");
const { GET: continueTo } = await import("./app/(classic)/signin/continue/route.ts");

/** What the landing reads, for the cases that put its answer and this proxy's side by side. */
function arriveAs(cookie: string | null): void {
  requestHeaders = new Headers(cookie === null ? ORIGIN : { ...ORIGIN, cookie });
}

arriveAs(null);

const signIn = (email: string) => sessionByCode(auth, store, email);

const removed = await signIn(REMOVED_EMAIL);
madeByPasskey(store, removed.row);

const ADMIN_URL = "http://localhost:3000/area/admin/spiele";

/** The proxy's own answer to a page request for the administrator's subtree carrying `cookie`, called directly. */
async function callProxy(cookie: string): Promise<Response> {
  const answer = await proxy(new NextRequest(ADMIN_URL, { headers: { host: "localhost:3000", cookie } }));

  assert.ok(answer instanceof Response, "the proxy answered something other than a response");
  return answer;
}

/** The path a redirect names, or `null` where the request was let through to the route. */
function redirectedTo(answer: Response): string | null {
  const location = answer.headers.get("location");
  return location === null ? null : new URL(location).pathname;
}

/** Where the landing sends the session `cookie` names, asked to return to `asked` where given: the redirect it throws. */
async function landedAt(cookie: string, asked?: string): Promise<string> {
  arriveAs(cookie);
  const url = new URL("http://localhost:3000/signin/continue");
  if (asked !== undefined) url.searchParams.set("return", asked);
  try {
    await continueTo(new NextRequest(url));
  } catch (error) {
    const digest: unknown = Reflect.get(error as object, "digest");
    assert.ok(typeof digest === "string", "the landing threw other than a redirect");
    return digest;
  }
  throw new Error("the landing answered without a redirect");
}

const landsOn = (path: string) => `NEXT_REDIRECT;replace;${path};307;`;

describe("where the sign-in's landing sends a session asked to return somewhere", () => {
  it("lands a session the area serves straight on an allowlisted address it was asked for", async () => {
    expect(await landedAt(removed.cookie, "/account")).toBe(landsOn("/account"));
    expect(await landedAt(removed.cookie, "/erasure?token=ein-token")).toBe(landsOn("/erasure?token=ein-token"));
  });

  it("lands it on the area's own page instead of an outside, an encoded or a protocol-relative address", async () => {
    const unasked = await landedAt(removed.cookie);
    assert.ok(unasked.startsWith("NEXT_REDIRECT;replace;/area"), `the control landed on ${unasked}`);

    for (const asked of ["https://example.com/area", "/area%2F..%2Fadmin", "//example.com/area", "/\\example.com/area"]) {
      expect(await landedAt(removed.cookie, asked), `${asked} was honoured`).toBe(unasked);
    }
  });

  it("carries an allowlisted address on through the passkey step", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    expect(await landedAt(cookie, "/account")).toBe(landsOn("/signin/passkey?return=%2Faccount"));
    expect(await landedAt(cookie, "//example.com/area")).toBe(landsOn("/signin/passkey"));
  });
});

describe("where the proxy sends a request for the administrator's subtree carrying a session cookie", () => {
  /* Optimistic, as Next and the library document a proxy's check: the cookie alone, and no backend read.
     The grant is the admin guard's, which refuses a session holding none on the same request. */
  it("lets a passkey session through whatever its grant, and leaves the grant to the admin guard", async ({ onTestFinished }) => {
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new TypeError("fetch failed")));
    onTestFinished(() => void fetched.mockRestore());

    expect(redirectedTo(await callProxy(removed.cookie))).toBe(null);
    expect(fetched.mock.calls.length, "the proxy asked the backend about a grant").toBe(0);

    arriveAs(removed.cookie);
    expect(await getAdminSession(), "the guard admitted a session holding no grant").toBe(null);
  });

  /* The factor is the guard's, read where the data is: the landing then answers the passkey step, where the
     public root would offer an administrator who has typed the code neither the step nor a way back. */
  it("lets a code-borne administrator through to the guard, which sends it to the landing's passkey step", async () => {
    const { cookie } = await signIn(ADMIN_EMAIL);

    expect((await callProxy(cookie)).headers.get("x-middleware-next"), "the proxy judged the session's factor").toBe("1");

    arriveAs(cookie);
    await expect(requireAdminRequest()).rejects.toSatisfy(
      (error: { digest?: unknown }) => error.digest === `NEXT_REDIRECT;replace;${ROUTES.signInLanding.path()};307;`,
    );
    expect((await getSignInLanding()).destination, "the landing sends a code-borne administrator somewhere else").toBe("/signin/passkey");
  });
});

/**
 * Whether Next runs the proxy for `url`: its server tries the raw path and then its decoded spelling
 * (`next/dist/server/lib/router-utils/resolve-routes.js`), which the testing helper does not, so both are asked.
 */
function matched(url: string, headers: Record<string, string>): boolean {
  const { pathname } = new URL(url);
  let spelled = pathname;
  try {
    spelled = decodeURIComponent(pathname);
  } catch {
    // Left as written, as Next leaves an escape it cannot decode.
  }

  // Handed over as the helper's own `cookies`: it writes that header from them whatever `headers` carried.
  const { cookie = "", ...rest } = headers;
  const cookies = Object.fromEntries(cookie.split(";").flatMap((pair) => (pair.includes("=") ? [cookiePair(pair.trim())] : [])));

  return [pathname, spelled].some((path) =>
    // A copy each time: the helper writes a `host` into the object it is handed.
    unstable_doesMiddlewareMatch({ config, url: new URL(path, url).href, headers: { ...rest }, cookies }),
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

const TEAM_URL = "http://localhost:3000/area/team/6890a1b2c3d4e5f607190001/2526";

describe("which addresses the proxy is run on", () => {
  /* Next strips the prefetch header before the proxy runs, so a prefetch reaching it carrying a session would
     slide it, a store read for a page nobody asked for. */
  it("skips a prefetch carrying a session cookie everywhere, the administrator's subtree included", async () => {
    const { cookie } = await signIn("leserin@example.org");
    for (const prefetch of PREFETCHES) {
      for (const url of [
        "http://localhost:3000/area",
        "http://localhost:3000/account",
        TEAM_URL,
        "http://localhost:3000/signin",
        ADMIN_URL,
        "http://localhost:3000/area/%61dmin/spiele",
      ]) {
        expect(matched(url, { ...prefetch, cookie }), `${url} runs the proxy on a signed-in prefetch, ${JSON.stringify(prefetch)}`).toBe(false);
      }
    }
  });
});

const PERSON_URLS = ["http://localhost:3000/area", "http://localhost:3000/account", "http://localhost:3000/area/zorbanax", TEAM_URL];

describe("where the proxy sends a request for an area's page", () => {
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
        (error: { digest?: unknown }) => error.digest === `NEXT_REDIRECT;replace;${ROUTES.signInLanding.path()};307;`,
      );
    }
  });
});

const EXPIRES_IN_MS = (auth.options.session?.expiresIn ?? Number.NaN) * 1000;
const UPDATE_AGE_MS = (auth.options.session?.updateAge ?? Number.NaN) * 1000;
const MINUTE_MS = 60 * 1000;

const PERSON_URL = "http://localhost:3000/account";

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
  // nothing whatever these say: it passes `disableRefresh` (`fl_frontend/src/core/auth/session.ts :: readServedSession`).
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

/** The stamps that say when a row was last used and when it lapses. */
const stampsOf = (row: SessionRow) => ({ updatedAt: row.updatedAt.getTime(), expiresAt: row.expiresAt.getTime() });

describe("where a session that is only read slides", () => {
  // Written there, the row would outlive the cookie the browser holds, which no later read inside `updateAge` repairs.
  it("never slides a session a page render reads, which could not carry the cookie", async () => {
    const { cookie, row } = await signIn("leserin@example.org");
    // Past the window a passkey is offered in, so the landing asks the plugin nothing.
    row.createdAt = new Date(Date.now() - 24 * 60 * MINUTE_MS);
    refreshedAgo(row, UPDATE_AGE_MS + MINUTE_MS);
    const due = stampsOf(row);

    arriveAs(cookie);
    expect((await getSignInLanding()).destination, "the render read no live session, so the case proves nothing").toBe("/area");

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
    const fetched = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json({ ...HOLDS_NOTHING, barred: true })));
    onTestFinished(() => void fetched.mockRestore());

    assert.ok(setSessionCookie(await visit(PERSON_URL, cookie), cookie), "nothing slid, so the case proves nothing");

    arriveAs(cookie);
    expect((await getSignInLanding()).destination).toBe("/signin");
    expect(await getSubjectSession()).toBe(null);
    expect(await getAccountSession()).toBe(null);
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
