import { NextResponse } from "next/server";

import { auth } from "./core/auth";

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
    return NextResponse.redirect(new URL("/signin", req.nextUrl));
  }

  if (req.auth?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
