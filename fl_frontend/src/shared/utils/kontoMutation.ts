import { cache } from "react";
import { headers } from "next/headers";

import { isUserAdmin } from "@/core/allowlist";
import { auth, isAdminSession, isFreshlySignedIn, isWithinPersonLifetime } from "@/core/auth";
import { STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import { runGuardedMutation } from "./adminMutation";

import type { ActionFailure } from "@/shared/types/types";

/** A press from a session the account page does not admit, one that expired between the render and the press. */
export const KONTO_FORBIDDEN = "Deine Anmeldung ist abgelaufen. Melde Dich neu an.";

/** The server's answer to a change sent after the step-up window closed; the page asks before it sends one. */
const BESTAETIGUNG_NOETIG = "Bestätige zuerst, dass Du es bist.";

/** The signed-in holder of an account page, in either lane; never the row's `token` (`docs/frontend/spec.md :: I198`). */
export type KontoSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * A change refused for want of a recent sign-in. `bestaetigen` is what the page opens the confirmation
 * on, so the sentence above is read only where the page could not ask first.
 */
export type BestaetigungFehlt = ActionFailure & { readonly bestaetigen: true };

// React's `cache`, as `getAdminSession` is: the page's sections and a server action's body share one
// read, and no request another's.
/**
 * Both lanes' own verdict on the served session: an allowlisted address is admitted by the
 * administrator's guard alone, so a session its mailbox made cannot manage that administrator's passkeys.
 */
export const getKontoSession = cache(async (): Promise<KontoSession | null> => {
  const served = await auth.api.getSession({ headers: await headers() });
  if (served === null) return null;

  if (isUserAdmin(served.user.email)) return isAdminSession(served) ? served : null;

  return isWithinPersonLifetime(served.session) ? served : null;
});

/** Until when the served session counts as confirmed, as epoch milliseconds, or `null` where it already does not. */
export function bestaetigtBis(served: KontoSession): number | null {
  return isFreshlySignedIn(served) ? new Date(served.session.createdAt).getTime() + STEP_UP_WINDOW_MS : null;
}

/**
 * The account page's spine: every change there is refused past the step-up window, whichever lane the
 * holder signs in by (`docs/frontend/spec.md :: I413`).
 */
export async function runKontoMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: (served: KontoSession) => Promise<T>,
): Promise<T | ActionFailure | BestaetigungFehlt> {
  return runGuardedMutation(mutationName, { lane: "Account", resolve: getKontoSession, forbidden: KONTO_FORBIDDEN }, async (served) =>
    isFreshlySignedIn(served) ? fn(served) : ({ success: false, error: BESTAETIGUNG_NOETIG, bestaetigen: true } satisfies BestaetigungFehlt),
  );
}
