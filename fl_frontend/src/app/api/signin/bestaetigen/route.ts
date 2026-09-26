import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { isAPIError } from "better-auth/api";

import { ANMELDE_BESTAETIGEN_PATH } from "@/core/anmeldeLink";
import { auth } from "@/core/auth";
import { frontend_config } from "@/core/config";
import { SIGN_IN_LANDING } from "@/core/signInLanding";

import type { NextRequest } from "next/server";

// A PATH in `Location`, never `request.nextUrl`'s origin: the standalone server builds that from the
// host it binds (`0.0.0.0:3000` behind nginx), which is an address no reader's browser can open.
/** 303, so the browser turns the form's POST into a GET of a page on the origin it is already on. */
function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone, and no GET: a mail gateway fetches every link in a message, and the same-origin guard
 * cannot tell its GET from a reader's, so a link signing in on GET is spent before anybody reads it.
 */
export async function POST(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return new NextResponse(null, { status: 403 });
  }

  // The shared spine lets a browser too old to send that header through, which every other handler
  // can afford.

  // This one SPENDS a credential, so a cross-site press of an attacker's own link would sign the
  // reader into the attacker's account. The fallback is the pinned origin, not the caller's.
  if (secFetchSite === null && request.headers.get("origin") !== new URL(frontend_config.AUTH_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }

  const token = (await request.formData()).get("token");
  // The page's own address with no token on it is where its one refusal state is rendered.
  if (typeof token !== "string" || token === "") return seeOther(ANMELDE_BESTAETIGEN_PATH);

  try {
    // The answer is dropped whole: with no `callbackURL` in the query this endpoint returns the raw
    // session token, and the one copy a browser may hold is the cookie `nextCookies()` writes.

    // No `request` either, so the library's own origin check never runs: the `Sec-Fetch-Site` and
    // `Origin` pair above stands in for it, and refuses the header-less caller that check admits.
    await auth.api.magicLinkVerify({ query: { token: token }, headers: await headers() });
  } catch (error) {
    // A dead, spent or expired token arrives as the library's own redirect-shaped error. Anything
    // else is this application failing, which is never worded to the reader as an invalid link.
    if (!isAPIError(error)) throw error;

    return seeOther(ANMELDE_BESTAETIGEN_PATH);
  }

  // The session cookie rides this response.
  return seeOther(SIGN_IN_LANDING);
}
