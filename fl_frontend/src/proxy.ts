import { NextResponse } from "next/server";

import { getRequestPasskeyStep } from "./core/auth/landing";
import { sessionCookieOf } from "./core/auth/library";
import { RETURN_PARAMETER, withReturnAddress } from "./core/auth/returnAddress";
import { slideSession } from "./core/auth/session";
import { MAILED_LINK_PAGES, swapMailedLinkToken } from "./core/mailedLink";
import { ROUTES } from "./core/routes";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the edge sets the one enforced policy. That is what lets the matcher stay scoped to
 * the pages a session serves — the slide is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  // First, so the token has left the address before a page, the sign-in or a script reads it.
  const page = MAILED_LINK_PAGES.find((path) => spellings(req.nextUrl.pathname).includes(path));
  const swapped = page === undefined ? null : swapMailedLinkToken(req, page);
  if (swapped !== null) return swapped;

  // Optimistic, as Next and the library document a proxy's check: the cookie alone, before any read, so a
  // visitor holding none meets sign-in, never an area's frame. Every verdict past it is a guard's.
  const holdsCookie = sessionCookieOf(req.headers) !== null;
  if (!holdsCookie && inArea(req.nextUrl.pathname)) return turnAway(req, ROUTES.signIn.path());

  let stored = false;
  try {
    // Only here can a person who only reads slide their cookie with their row. The library expires a cookie whose
    // row is gone or expired, and the page's guard refuses the rest.
    if (holdsCookie) stored = await slideSession(req.headers);
  } catch {
    // A store that did not answer signs nobody out: the page's own guard reads it again and fails
    // into its area's error boundary, which renders nothing it guards.
  }

  // A session asking for the sign-in is sent to the landing before anything renders, as Next's authentication guide
  // redirects a signed-in visitor in its proxy. The landing ends a session no lane serves, and the next request's
  // slide then finds no row, so this cannot loop.
  if (stored && isPageLoad(req, ROUTES.signIn.path())) return toLanding(req);

  // So is one asking for the passkey step it does not hold, a page that would otherwise paint its frame and then
  // redirect: the guard's own answer, asked of this request. The landing sends here only a session holding a step.
  if (isPageLoad(req, ROUTES.signInPasskey.path()) && (await holdsNoPasskeyStep(req))) return toLanding(req);

  return NextResponse.next();
}

/** A page load of `path`, never its form's server action, which posts to the same address. */
function isPageLoad(req: NextRequest, path: string): boolean {
  return req.method === "GET" && spellings(req.nextUrl.pathname).includes(path);
}

async function holdsNoPasskeyStep(req: NextRequest): Promise<boolean> {
  try {
    return (await getRequestPasskeyStep(req.headers)) === null;
  } catch {
    // As the slide's: the page reads it again and fails into its error boundary.
    return false;
  }
}

/** The landing, the address the request asked to return to carried where the allowlist holds it. */
function toLanding(req: NextRequest): NextResponse {
  const landing = withReturnAddress(ROUTES.signInLanding.path(), req.nextUrl.searchParams.get(RETURN_PARAMETER));
  return NextResponse.redirect(new URL(landing, req.nextUrl));
}

function turnAway(req: NextRequest, destination: string): NextResponse {
  // Never a 307 for an action's POST: its `fetch` replays one as a POST it cannot read. This header,
  // with no body, is the redirect Next's action client navigates on.
  if (req.method === "POST" && req.headers.has("next-action")) {
    return new NextResponse(null, { headers: { "x-action-redirect": `${destination};replace` } });
  }

  // The page asked for rides the sign-in only where the allowlist holds it, so a mailed link keeps its target.
  const returnTo = withReturnAddress(destination, `${req.nextUrl.pathname}${req.nextUrl.search}`);
  return NextResponse.redirect(new URL(returnTo, req.nextUrl));
}

/** The signed-in pages' first segments: a person's area, the administration and the account, as the matcher lists them. */
const AREAS = ["/area", "/admin", "/account"] as const;

function inArea(pathname: string): boolean {
  return spellings(pathname).some((path) => AREAS.some((area) => path === area || path.startsWith(`${area}/`)));
}

/** Raw and decoded both, as Next tests `config.matcher`: a page is judged on every spelling the matcher admits. */
function spellings(pathname: string): string[] {
  return [pathname, decoded(pathname)];
}

// A malformed escape is left as written, as Next leaves it: a person's address never throws here.
function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export const config = {
  // Next tests the raw path and its decoded spelling both, so an escaped `area` is matched too. A source is a
  // literal Next reads at build time, so the three areas are spelled here rather than read from `AREAS`.
  matcher: [
    // A prefetch is no page anybody read, and Next runs the proxy on every one a page's links make. Next
    // strips the prefetch header before the proxy runs, so only the matcher can keep it from sliding.
    {
      source: "/(area|admin|account)/:path*",
      missing: [
        // No `value`, so it matches the header whatever it carries: `1` on the route tree and on every segment a link's
        // partial prefetch fetches, `2` and `3` on a runtime prefetch, as Next's segment cache sends them. A full
        // prefetch, a link's `prefetch={true}`, sends none and runs the proxy.
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // Save a prefetch carrying no session cookie: the cookie check turns it away before any read, so a visitor
    // holding none is sent to sign-in rather than shown the prefetched frame.
    {
      source: "/(area|admin|account)/:path*",
      has: [{ type: "header", key: "next-router-prefetch" }],
      // A matcher holds literals, so the name is matched on its suffix, of any prefix: a foreign cookie bearing it
      // skips the proxy, and its prefetched frame paints until the page's guard sends it on.
      missing: [{ type: "header", key: "cookie", value: ".*\\.session_token=.*" }],
    },
    {
      source: "/(area|admin|account)/:path*",
      has: [{ type: "header", key: "purpose", value: "prefetch" }],
      missing: [{ type: "header", key: "cookie", value: ".*\\.session_token=.*" }],
    },
    // `MAILED_LINK_PAGES`, on a request carrying a token alone, which an empty `token` is not: Next's `has` reads an
    // empty query value as absent.
    { source: "/(erasure|registrierung)", has: [{ type: "query", key: "token" }] },
    {
      source: "/signin/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
