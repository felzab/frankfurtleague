import { NextResponse } from "next/server";

import { auth } from "./core/auth";
import { buildContentSecurityPolicy } from "./core/csp";

import type { NextAuthRequest } from "next-auth";
import type { NextFetchEvent, NextRequest } from "next/server";

// Report-Only for now. The enforced policy lives in nginx.conf; flipping this one to enforcing is
// ledger row R3b-S9.1b and needs a deploy cycle of real violation reports first.
const CSP_HEADER = "Content-Security-Policy-Report-Only";

// Wrapping with `auth()` resolves the session -- a Mongo round-trip -- before the handler runs, so
// it must stay scoped to /admin. The matcher below covers every document route for the CSP header;
// making that the `auth()` boundary would put a session lookup in front of every public page load.
// Both parameters are annotated to select `auth()`'s middleware overload; with only `req` typed,
// TypeScript resolves the route-handler overload instead and rejects the NextFetchEvent below.
const adminGuard = auth((req: NextAuthRequest, _event: NextFetchEvent) => {
  const isLoggedIn = !!req.auth;

  // Not logged in -> Send to sign in
  if (!isLoggedIn) {
    const loginUrl = new URL("/signin", req.nextUrl);
    const fullUrl = req.nextUrl.pathname + req.nextUrl.search;
    loginUrl.searchParams.set("callbackUrl", fullUrl);
    return NextResponse.redirect(loginUrl);
  }

  // Logged in, but NOT an admin -> Kick to homepage
  if (req.auth?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  // Authorized admin -> fall through to the shared CSP response below.
  return undefined;
});

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  const policy = buildContentSecurityPolicy(crypto.randomUUID());

  if (req.nextUrl.pathname.startsWith("/admin")) {
    const guarded = await adminGuard(req, event);

    // On an authorized request the wrapper substitutes its own `NextResponse.next()` for our
    // `undefined`, which carries no CSP request header -- so only a redirect is worth propagating.
    if (guarded?.headers.get("location")) {
      guarded.headers.set(CSP_HEADER, policy);
      return guarded;
    }
  }

  // Next derives the script nonce from the CSP on the *request*, accepting either the enforcing or
  // the Report-Only header (app-render.js `parseRequestHeaders`). Setting it only on the response
  // would leave the nonce matching nothing.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(CSP_HEADER, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, policy);
  return response;
}

// Every document route, so the CSP header is set app-wide. Excludes `/api` (Auth.js handles its own
// routes and needs no policy), Next's static output, and static files served straight from disk.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|txt|xml|webmanifest)$).*)"],
};
