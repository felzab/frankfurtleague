import { NextResponse } from "next/server";

import { PASSKEY_FACTOR, servedSessionOf, sessionCookieOf, slideSession } from "./core/auth";
import { SIGN_IN_LANDING } from "./core/signInLanding";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/shared/security_headers.conf`. That is what lets
 * the matcher stay scoped to the pages a session serves — the session read is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  const inPersonLane = inPersonArea(req.nextUrl.pathname);

  // Optimistic, as Next documents a proxy's check: the cookie alone, before any read, so a visitor holding
  // none meets sign-in and never the area's frame. A prefetch reaches here only carrying none (`config`).
  if (inPersonLane && sessionCookieOf(req.headers) === null) {
    return turnAway(req, "/signin");
  }

  let session: Awaited<ReturnType<typeof servedSessionOf>>;
  try {
    // Every arm, before any answer is chosen: only here can a read by a person who only reads slide
    // their cookie as well as their row (`docs/frontend/spec.md :: I495`).
    const slid = await slideSession(req.headers);

    // Judged by the administrator's checks, every person would be turned away from the sign-in's pages
    // and their own. A person's page is turned away on this read where the cookie names no session, as
    // every guard there would.
    if (!inAdminArea(req.nextUrl.pathname)) {
      return inPersonLane && slid === null ? turnAway(req, "/signin") : NextResponse.next();
    }

    // A server action's POST takes the checks below too: an action writing a cookie makes Next render
    // the tree at the POSTed URL into its answer, admin layout and all (`docs/frontend/spec.md :: I243`).
    session = await servedSessionOf(slid);
  } catch {
    // A store that did not answer signs nobody out: the page's own guard reads it again and fails
    // into its area's error boundary, which renders nothing it guards (`docs/frontend/spec.md :: I519`).
    return NextResponse.next();
  }

  // No return destination carried across: honouring one needs it checked against an allowlist first.
  if (!session) {
    return turnAway(req, "/signin");
  }

  // Optimistic, as Next documents a proxy's check: the session and its factor, never the grant, which every
  // guard reads (`docs/frontend/spec.md :: I122`). The landing answers a code-borne session its passkey step.
  if (session.session.authFactor !== PASSKEY_FACTOR) {
    return turnAway(req, SIGN_IN_LANDING);
  }

  return NextResponse.next();
}

function turnAway(req: NextRequest, destination: string): NextResponse {
  // Never a 307 for an action's POST: its `fetch` replays one as a POST it cannot read. This header,
  // with no body, is the redirect Next's action client navigates on (`docs/frontend/spec.md :: I251`).
  if (req.method === "POST" && req.headers.has("next-action")) {
    return new NextResponse(null, { headers: { "x-action-redirect": `${destination};replace` } });
  }

  return NextResponse.redirect(new URL(destination, req.nextUrl));
}

// eslint-disable-next-line local/admin-link -- the subtree this guard refuses on, not a link
const ADMIN_AREA = "/bereich/admin";
const BEREICH = "/bereich";

/** Raw and decoded both, as Next tests `config.matcher`: the subtree is judged on every spelling the matcher admits. */
function inAdminArea(pathname: string): boolean {
  return [pathname, decoded(pathname)].some((path) => path === ADMIN_AREA || path.startsWith(`${ADMIN_AREA}/`));
}

/** Every address under `/bereich` the administrator's checks leave, the person's and each team's. */
function inPersonArea(pathname: string): boolean {
  return !inAdminArea(pathname) && [pathname, decoded(pathname)].some((path) => path === BEREICH || path.startsWith(`${BEREICH}/`));
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
  // Next tests the raw path and its decoded spelling both, so an escaped `admin` is matched too.
  matcher: [
    // eslint-disable-next-line local/admin-link -- the subtree this guard judges, not a link
    "/bereich/admin/:path*",
    // A prefetch is no page anybody read, and Next runs the proxy on every one a page's links make. Next
    // strips the prefetch header before the proxy runs, so only the matcher can keep it from sliding.
    {
      source: "/bereich/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    // Save a prefetch carrying no session cookie, of any prefix: the cookie check turns it away before any
    // read, so a visitor holding none is sent to sign-in rather than shown the prefetched frame.
    {
      source: "/bereich/:path*",
      has: [{ type: "header", key: "next-router-prefetch" }],
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
