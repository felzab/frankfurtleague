import { NextResponse } from "next/server";

import { auth } from "./core/auth";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/prod.conf`. That is what lets
 * the matcher stay scoped to `/admin` — `auth()` is a Mongo round trip, never on a public load.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;

  // POST alone: a GET carrying the header is an ordinary page render, and exempting one serves the
  // admin shell to any caller. A server action's response must be an RSC payload, and
  // `getAdminSession()` authorizes it (`docs/frontend/spec.md :: I7`).
  if (req.method === "POST" && req.headers.has("next-action")) {
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
