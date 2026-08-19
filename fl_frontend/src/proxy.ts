import { NextResponse } from "next/server";

import { auth } from "./core/auth";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx.conf`. That is what lets
 * the matcher stay scoped to `/admin` — `auth()` is a Mongo round trip, never on a public load.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;

  // A server action is never redirected: its response must be an RSC payload, and the action's own
  // `getAdminSession()` refuses it anyway (frontend spec I7). Keyed on react-dom's header.
  if (req.headers.has("next-action")) {
    return NextResponse.next();
  }

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
