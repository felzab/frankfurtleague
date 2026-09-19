import { NextResponse } from "next/server";

import { auth } from "./core/auth";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/prod.conf`. That is what lets
 * the matcher stay scoped to `/admin` — `auth()` is a Mongo round trip, never on a public load.
 */
export default auth((req) => {
  // A server action's POST takes the checks below too: an action writing a cookie makes Next render
  // the tree at the POSTed URL into its response, admin layout and all (`docs/frontend/spec.md :: I243`).
  const isLoggedIn = !!req.auth;

  // No callbackUrl: honouring one needs the destination checked against an allowlist first.
  if (!isLoggedIn) {
    return turnAway(req, "/signin");
  }

  if (req.auth?.user?.role !== "admin") {
    return turnAway(req, "/");
  }

  return NextResponse.next();
});

function turnAway(req: NextRequest, destination: string): NextResponse {
  // Never a 307 for an action's POST: its `fetch` replays one as a POST it cannot read. This header,
  // with no body, is the redirect Next's action client navigates on (`docs/frontend/spec.md :: I251`).
  if (req.method === "POST" && req.headers.has("next-action")) {
    return new NextResponse(null, { headers: { "x-action-redirect": `${destination};replace` } });
  }

  return NextResponse.redirect(new URL(destination, req.nextUrl));
}

export const config = {
  matcher: ["/admin/:path*"],
};
