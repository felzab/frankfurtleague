import { NextResponse } from "next/server";

import { PASSKEY_FACTOR, readServedSession } from "./core/auth";
import { SIGN_IN_LANDING } from "./core/signInLanding";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/shared/security_headers.conf`. That is what lets
 * the matcher stay scoped to the admin subtree — the session read is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  // A server action's POST takes the checks below too: an action writing a cookie makes Next render
  // the tree at the POSTed URL into its answer, admin layout and all (`docs/frontend/spec.md :: I243`).
  const session = await readServedSession(req.headers);

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

export const config = {
  // Next tests the raw path and its decoded spelling both, so an escaped `admin` is matched too, and every
  // person's page under `/bereich` runs no proxy at all.
  // eslint-disable-next-line local/admin-link -- the subtree this guard judges, not a link
  matcher: ["/bereich/admin/:path*"],
};
