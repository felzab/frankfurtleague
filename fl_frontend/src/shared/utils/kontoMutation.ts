import { getKontoSession, isFreshlySignedIn } from "@/core/auth";
import { STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import { runGuardedMutation } from "./adminMutation";

import type { ActionFailure } from "@/shared/types/types";

/** A press from a session the account page does not admit, one that expired between the render and the press. */
export const KONTO_FORBIDDEN = "Deine Anmeldung ist abgelaufen. Melde Dich neu an.";

/** The server's answer to a change sent after the step-up window closed; the page asks before it sends one. */
const STEP_UP_REQUIRED = "Bestätige zuerst, dass Du es bist.";

/** The signed-in holder of the account page, in either lane; never the row's `token` (`docs/frontend/spec.md :: I198`). */
export type KontoSession = NonNullable<Awaited<ReturnType<typeof getKontoSession>>>;

/**
 * A change refused for want of a recent sign-in. `stepUp` is what the page opens the confirmation
 * on, so the sentence above is read only where the page could not ask first.
 */
export type StepUpRequired = ActionFailure & { readonly stepUp: true };

/** Until when the served session counts as confirmed, as epoch milliseconds, or `null` where it already does not. */
export function freshUntil(served: KontoSession): number | null {
  return isFreshlySignedIn(served) ? new Date(served.session.createdAt).getTime() + STEP_UP_WINDOW_MS : null;
}

/**
 * The account page's spine: every change there is refused past the step-up window, whichever lane the
 * holder signs in by (`docs/frontend/spec.md :: I413`).
 */
export async function runKontoMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: (served: KontoSession) => Promise<T>,
): Promise<T | ActionFailure | StepUpRequired> {
  return runGuardedMutation(mutationName, { lane: "Account", resolve: getKontoSession, forbidden: KONTO_FORBIDDEN }, async (served) =>
    isFreshlySignedIn(served) ? fn(served) : ({ success: false, error: STEP_UP_REQUIRED, stepUp: true } satisfies StepUpRequired),
  );
}
