import { NextResponse } from "next/server";

import { PASSKEY_FACTOR, servedSessionOf, slideSession } from "./core/auth";
import { SIGN_IN_LANDING } from "./core/signInLanding";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/shared/security_headers.conf`. That is what lets
 * the matcher stay scoped to the pages a session serves — the session read is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  // Every arm, before any answer is chosen: only here can a read by a person who only reads slide
  // their cookie as well as their row (`docs/frontend/spec.md :: I495`).
  const slid = await slideSession(req.headers);

  // Every other word is a person's or the sign-in's, guarded by its own page: judged here by the
  // administrator's checks, it would turn every person away.
  if (!inAdminArea(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // A server action's POST takes the checks below too: an action writing a cookie makes Next render
  // the tree at the POSTed URL into its answer, admin layout and all (`docs/frontend/spec.md :: I243`).
  const session = await servedSessionOf(slid);

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

/** Raw and decoded both, as Next tests `config.matcher`: the subtree is judged on every spelling the matcher admits. */
function inAdminArea(pathname: string): boolean {
  return [pathname, decoded(pathname)].some((path) => path === ADMIN_AREA || path.startsWith(`${ADMIN_AREA}/`));
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
    // A prefetch is no page anybody read, and Next runs the proxy on every one a page's links make.
    { source: "/bereich/:path*", missing: [{ type: "header", key: "next-router-prefetch" }] },
    { source: "/signin/:path*", missing: [{ type: "header", key: "next-router-prefetch" }] },
  ],
};
