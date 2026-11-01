import { NextResponse } from "next/server";

import { sessionCookieOf, slideSession } from "./core/auth";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/shared/security_headers.conf`. That is what lets
 * the matcher stay scoped to the pages a session serves — the slide is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  // Optimistic, as Next and the library document a proxy's check: the cookie alone, before any read, so a
  // visitor holding none meets sign-in, never an area's frame. Every verdict past it is a guard's.
  if (sessionCookieOf(req.headers) === null) {
    // No return destination carried across: honouring one needs it checked against an allowlist first.
    return inArea(req.nextUrl.pathname) ? turnAway(req, "/signin") : NextResponse.next();
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

  return NextResponse.redirect(new URL(destination, req.nextUrl));
}

const AREA = "/bereich";

/** Raw and decoded both, as Next tests `config.matcher`: the area is judged on every spelling the matcher admits. */
function inArea(pathname: string): boolean {
  return [pathname, decoded(pathname)].some((path) => path === AREA || path.startsWith(`${AREA}/`));
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
  // Next tests the raw path and its decoded spelling both, so an escaped `bereich` is matched too.
  matcher: [
    // A prefetch is no page anybody read, and Next runs the proxy on every one a page's links make. Next
    // strips the prefetch header before the proxy runs, so only the matcher can keep it from sliding.
    {
      source: "/bereich/:path*",
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
      source: "/bereich/:path*",
      has: [{ type: "header", key: "next-router-prefetch" }],
      // A matcher holds literals, so the name is matched on its suffix, of any prefix: a foreign cookie bearing it
      // skips the proxy, and its prefetched frame paints until the page's guard sends it on.
      missing: [{ type: "header", key: "cookie", value: ".*\\.session_token=.*" }],
    },
    {
      source: "/bereich/:path*",
      has: [{ type: "header", key: "purpose", value: "prefetch" }],
      missing: [{ type: "header", key: "cookie", value: ".*\\.session_token=.*" }],
    },
    {
      source: "/signin/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
