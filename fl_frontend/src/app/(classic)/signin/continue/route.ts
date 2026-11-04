import { redirect } from "next/navigation";

import { getSignInDestination } from "@/core/auth";
import { allowedReturnAddress, RETURN_PARAMETER, withReturnAddress } from "@/core/auth/returnAddress";
import { rolesOf } from "@/core/roles";
import { getSubjectSession } from "@/core/subject";
import { zieleOf } from "@/features/funktionen/utils";

import type { NextRequest } from "next/server";

/**
 * Where every finished sign-in step lands, a dispatcher rendering nothing: one redirect, straight to the page the
 * session goes to, the address it was asked to return to where the allowlist holds it. GET alone, as a link and a
 * document load arrive; the passkey requirement and the session lifetimes are the guard's, judged per request.
 */
export async function GET(request: NextRequest): Promise<never> {
  const asked = allowedReturnAddress(request.nextUrl.searchParams.get(RETURN_PARAMETER));
  const landing = await getSignInDestination();

  // Outside any `try`, as Next documents for a Route Handler: `redirect` throws to lead on.
  redirect(landing === "/bereich" ? (asked ?? (await areaLanding())) : withReturnAddress(landing, asked));
}

/** The page `/bereich` itself would send the session on to, so the sign-in lands there without a second redirect. */
async function areaLanding(): Promise<string> {
  // A backend that cannot answer is `/bereich`'s to say, which renders its area's outage panel.
  const subject = await getSubjectSession().catch(() => null);
  if (subject === null) return "/bereich";

  // A lone team seat goes straight to its team, as `app/bereich/(persoenlich)/page.tsx` sends it.
  const [erstes, ...weitere] = zieleOf(rolesOf(subject).roles);
  return erstes !== undefined && weitere.length === 0 && erstes.funktionen[0].art === "kontakt" ? erstes.href : "/bereich";
}
