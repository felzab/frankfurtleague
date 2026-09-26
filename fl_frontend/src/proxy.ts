import { NextResponse } from "next/server";

import { auth, isAdminSession } from "./core/auth";
import { SIGN_IN_LANDING } from "./core/signInLanding";

import type { NextRequest } from "next/server";

/**
 * No per-request nonce CSP here: the one enforced policy lives in `nginx/shared/security_headers.conf`. That is what lets
 * the matcher stay scoped to `/bereich` — the session read is a Mongo round trip, never on a public load.
 */
export async function proxy(req: NextRequest): Promise<NextResponse> {
  // Every other word under `/bereich` is a person's, guarded by its own lane in the person and team
  // layouts (`fl_frontend/src/features/funktionen/components/providers/FunktionenGuard.tsx`): judged
  // here by the administrator's verdict, it would turn every person away.
  if (!inAdminArea(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  // A server action's POST takes the checks below too: an action writing a cookie makes Next render
  // the tree at the POSTed URL into its response, admin layout and all (`docs/frontend/spec.md :: I243`).
  const session = await auth.api.getSession({ headers: req.headers });

  // No return destination carried across: honouring one needs it checked against an allowlist first.
  if (!session) {
    return turnAway(req, "/signin");
  }

  // Re-derived here rather than read off the session: the verdict is the allowlist, the two
  // administrator figures and the factor, each judged against this request (`:: I122`).

  // To the landing rather than the public root: an administrator refused for the missing factor
  // alone is one step from being through, and the root offers them neither that step nor a message.
  if (!isAdminSession(session)) {
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

// eslint-disable-next-line local/admin-link -- the subtree this guard refuses on, not a link
const ADMIN_AREA = "/bereich/admin";

/** Raw and decoded both, as Next tests `config.matcher`: the subtree is judged on every spelling the matcher admits. */
function inAdminArea(pathname: string): boolean {
  return [pathname, decoded(pathname)].some((path) => path === ADMIN_AREA || path.startsWith(`${ADMIN_AREA}/`));
}

// A malformed escape is left as written, as Next leaves it: a person's address never throws here.
function decoded(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

export const config = {
  matcher: ["/bereich/:path*"],
};
