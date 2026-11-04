import { redirect } from "next/navigation";

import { getSignInLanding } from "@/core/auth/landing";
import { allowedReturnAddress, RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { soleTeamOf, zieleOf } from "@/features/funktionen/utils";

import type { NextRequest } from "next/server";

/**
 * Where every finished sign-in step lands, a dispatcher rendering nothing: one redirect, straight to the page the
 * session goes to, the address it was asked to return to where the allowlist holds it. GET alone, as a link and a
 * document load arrive; the passkey requirement and the session lifetimes are the guard's, judged per request.
 */
export async function GET(request: NextRequest): Promise<never> {
  const asked = allowedReturnAddress(request.nextUrl.searchParams.get(RETURN_PARAMETER));
  const { destination, subject } = await getSignInLanding();
  const area = ROUTES.area.path();

  // `/area`'s own landing rule over the person the landing read, so the sign-in lands where `/area` would send it
  // without a second redirect; a backend that did not answer is `/area`'s to say, which renders its outage panel.
  const landing = destination === area ? (asked ?? (subject === null ? null : soleTeamOf(zieleOf(rolesOf(subject).roles))) ?? area) : null;

  // Outside any `try`, as Next documents for a Route Handler: `redirect` throws to lead on.
  redirect(landing ?? withReturnAddress(destination, asked));
}
