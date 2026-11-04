import { NextResponse } from "next/server";

import { sessionCookieOf } from "./core/auth/library";
import { withReturnAddress } from "./core/auth/returnAddress";
import { slideSession } from "./core/auth/session";
import { MAILED_LINK_PAGES, swapMailedLinkToken } from "./core/mailedLink";
import { ROUTES } from "./core/routes";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/shared/security_headers.conf`. That is what lets
 * the matcher stay scoped to the pages a session serves — the slide is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  // First, so the token has left the address before a page, the sign-in or a script reads it.
  const page = MAILED_LINK_PAGES.find((path) => spellings(req.nextUrl.pathname).includes(path));
  const swapped = page === undefined ? null : swapMailedLinkToken(req, page);
  if (swapped !== null) return swapped;

  // Optimistic, as Next and the library document a proxy's check: the cookie alone, before any read, so a
  // visitor holding none meets sign-in, never an area's frame. Every verdict past it is a guard's.
  if (sessionCookieOf(req.headers) === null) {
    return inArea(req.nextUrl.pathname) ? turnAway(req, ROUTES.signIn.path()) : NextResponse.next();
  }

  try {
    // Only here can a person who only reads slide their cookie with their row.
    // Its answer decides nothing: the library expires a cookie whose row is gone or expired, and the
    // page's guard refuses the rest.
    await slideSession(req.headers);
  } catch {
    // A store that did not answer signs nobody out: the page's own guard reads it again and fails
    // into its area's error boundary, which renders nothing it guards.
  }

  return NextResponse.next();
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
        // No `value`, so it matches the header whatever it carries, a partial prefetch's `2` and `3` among them. A full
        // prefetch sends no header and runs the proxy.
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
    // `fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_PAGES`, on a request carrying a token alone, which an empty
    // `token` is not: Next's `has` reads an empty query value as absent.
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
