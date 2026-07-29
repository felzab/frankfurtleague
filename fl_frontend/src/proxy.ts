import { NextResponse } from "next/server";

import { auth } from "./core/auth";

/**
 * Admin route guard. Defence in depth only -- `src/app/admin/layout.tsx` calls `getAdminSession()`
 * independently, so page rendering fails closed even if this matcher stops matching (R3b §S3.1).
 *
 * This file briefly also emitted a per-request nonce CSP. That was removed with the decision to
 * keep a single enforced policy in `nginx.conf` -- see ledger row R3b-S9.1b for the measurements
 * behind it. The matcher is scoped back to `/admin` as a result: `auth()` resolves the session, and
 * that is a Mongo round-trip, so it must never sit in front of a public page load.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;

  // Not logged in -> Send to sign in.
  // No callbackUrl: nothing consumed it -- the signin page ignores searchParams and the action
  // hardcodes redirectTo: "/admin" -- and honouring it later is the opposite change, one that
  // introduces an open redirect unless the value is allowlisted. Deep-linking is not worth that.
  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/signin", req.nextUrl));
  }

  // Logged in, but NOT an admin -> Kick to homepage
  if (req.auth?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Authorized Admin -> Let them through
  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*"],
};
