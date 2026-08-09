/**
 * CORE · admin route guard
 *
 * Runs before every `/admin` request. Defence in depth only — `app/admin/layout.tsx` calls
 * `getAdminSession()` independently, so page rendering fails closed even if this matcher stops
 * matching.
 *
 * Invariants:
 * - The matcher stays scoped to `/admin` — `auth()` is a Mongo round trip, never on a public load.
 * - No `callbackUrl` on the redirect — honouring one later is an open redirect.
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
 * Admin route guard. Defence in depth only -- `src/app/admin/layout.tsx` calls `getAdminSession()`
 * independently, so page rendering fails closed even if this matcher stops matching (R3b §S3.1).
 *
 * This file does NOT emit a per-request nonce CSP, following the decision to
 * keep a single enforced policy in `nginx.conf` -- see ADR-0016 for the measurements
 * behind it. The matcher is scoped back to `/admin` as a result: `auth()` resolves the session, and
 * that is a Mongo round-trip, so it must never sit in front of a public page load.
 */
export default auth((req) => {
  const isLoggedIn = !!req.auth;

  // A SERVER ACTION is never redirected, whatever this guard decides about it.
  //
  // An action is a POST whose response must be an RSC payload. A redirect is followed by the client's
  // own fetch, which then reads an HTML page and reports "An unexpected response was received from
  // the server" -- an error naming nothing, on a request that was refused for a perfectly ordinary
  // reason. Measured against this stack: `POST /admin/spiele/<id>` with an action header answers
  // `redirects=1, final=/signin`.
  //
  // **Letting it through costs no authorization**, which is the only reason this is allowed to be the
  // fix. This guard is defence in depth by its own docblock, and every admin action independently
  // begins with `getAdminSession()` and returns an access-denied result rather than throwing (spec
  // I7, all nine of them). So an unauthorized action still fails, and it now fails as a RESULT the
  // form can render -- "Access Denied" in a toast -- instead of as an unparseable response.
  //
  // Keyed on the header react-dom sends on every Server Action request. `sec-fetch-dest` is not used
  // in its place: it distinguishes a document from a fetch, which would also exempt every RSC
  // prefetch, and those SHOULD keep being redirected so a stale client learns it is signed out.
  if (req.headers.has("next-action")) {
    return NextResponse.next();
  }

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
