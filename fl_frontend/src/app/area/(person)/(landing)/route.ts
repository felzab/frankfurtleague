import { redirect } from "next/navigation";

import { withReturnAddress } from "@/core/auth/returnAddress";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { landingTargetOf, placesOf } from "@/features/roles/utils";

import type { Route } from "next";

/** Where `/area` sends the request, as `landingTargetOf` decides for the person the session names. */
async function targetOf(): Promise<Route> {
  // A lookup that failed is the backend's: the chooser reads the person again and fails into the person frame's error card.
  const subject = await getSubjectSession().catch(() => undefined);
  if (subject === undefined) return ROUTES.areaRoles.path();
  if (subject === null) return withReturnAddress(ROUTES.signIn.path(), ROUTES.area.path());
  // An address holding a grant, past the administrator's window or short of the passkey, owes a fresh sign-in or its
  // passkey step, which the sign-in's landing sends it on to, not a person's place.
  if (!subject.isAdmin && subject.records.admin_tier !== null) return ROUTES.signInLanding.path();
  return landingTargetOf(placesOf(subject));
}

/**
 * `/area`, where a signed-in person lands: one redirect before anything renders, to Konto for a person holding no
 * Funktion, to the one place they hold, or to the chooser between several. GET alone, as a link and a document load
 * arrive.
 */
export async function GET(): Promise<never> {
  // Outside any `try`, as Next documents for a Route Handler: `redirect` throws to lead on.
  redirect(await targetOf());
}
