/**
 * CORE · admin route guard
 *
 * Runs before every `/admin` request. Defence in depth only — `AdminAuthGuard`, which
 * `app/admin/layout.tsx` renders below its Suspense boundary, calls `getAdminSession()`
 * independently, so page rendering fails closed even if this matcher stops matching.
 *
 * Invariants:
 * - The matcher stays scoped to `/admin` — `auth()` is a Mongo round trip, never on a public load.
 * - No `callbackUrl` on the redirect — honouring one needs an allowlist first (ADR-0061).
 * - A server-action request is never redirected — the HTML reply breaks the RSC stream; the
 *   action's own `getAdminSession()` is what refuses it.
 * - This file is `proxy.ts`, not `middleware.ts` — the latter is the deprecated name.
 *
 * See:
 * - docs/frontend/overview.md — the authentication section
 */

import { NextResponse } from "next/server";

import { auth } from "./core/auth";

/**
 * This file does NOT emit a per-request nonce CSP, following the decision to
 * keep a single enforced policy in `nginx.conf` -- see ADR-0011 for the measurements
 * behind it. The matcher is scoped back to `/admin` as a result: `auth()` resolves the session, and
 * that is a Mongo round-trip, so it must never sit in front of a public page load.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;

  // A SERVER ACTION is never redirected: its response must be an RSC payload, and
  // letting it through costs no authorization -- every admin action checks its own
  // (frontend spec I7). Keyed on react-dom's header, never `sec-fetch-dest`.
  if (req.headers.has("next-action")) {
    return NextResponse.next();
  }

  // Not logged in -> send to sign in, with no callbackUrl: honouring one needs the destination
  // checked against an allowlist first, and deep-linking does not earn that (ADR-0061).
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
