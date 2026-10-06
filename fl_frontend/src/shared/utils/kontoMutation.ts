import { getKontoSession, isFreshlySignedIn } from "@/core/auth";
import { ENROLMENT_WINDOW_MS, isWithinEnrolmentWindow, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import { runGuardedMutation, stepUpRequired } from "./adminMutation";

import type { ConfirmedUntil } from "@/shared/hooks/useConfirmationWindows";
import type { ActionFailure } from "@/shared/types/types";
import type { StepUpRequired } from "./adminMutation";

/** A press from a session the account page does not admit, one that expired between the render and the press. */
export const KONTO_FORBIDDEN = "Deine Anmeldung ist abgelaufen. Melde Dich neu an.";

/** The signed-in holder of the account page, in either lane; never the row's `token` (`docs/frontend/spec.md :: I198`). */
export type KontoSession = NonNullable<Awaited<ReturnType<typeof getKontoSession>>>;

/**
 * Whether the served session is the one the page was drawn for: a confirmation made once the page's
 * session has ended answers a challenge naming nobody, and can sign another account in
 * (`docs/frontend/spec.md :: I428`).
 */
export function isHeldBy(served: { readonly user: { readonly id: string } }, holderId: string): boolean {
  return served.user.id === holderId;
}

/** Until when the served session counts as confirmed, as epoch milliseconds, or `null` where it already does not. */
function freshUntil(served: KontoSession): number | null {
  return isFreshlySignedIn(served) ? new Date(served.session.createdAt).getTime() + STEP_UP_WINDOW_MS : null;
}

/**
 * Until when the served session may add a passkey, or `null` where it already may not: the enrolment
 * guard's narrower window, inside the confirmation every change takes (`docs/frontend/spec.md :: I411`).
 */
export function enrolmentUntil(served: KontoSession): number | null {
  if (!isFreshlySignedIn(served) || !isWithinEnrolmentWindow(served.session.createdAt)) return null;
  return new Date(served.session.createdAt).getTime() + ENROLMENT_WINDOW_MS;
}

/** What a page's step-up is served, on both surfaces: no figure reaches a page without the clock it was read on. */
export function confirmedUntil(served: KontoSession): ConfirmedUntil {
  return { freshUntil: freshUntil(served), enrolmentUntil: enrolmentUntil(served), servedAt: Date.now() };
}

/**
 * The account page's guard without the step-up window, for the one press that renews it: the code a
 * holder confirms with must be sendable from a session already past the window.
 */
export async function runKontoStepUp<T extends { success: boolean }>(
  mutationName: string,
  fn: (served: KontoSession) => Promise<T>,
): Promise<T | ActionFailure> {
  return runGuardedMutation(mutationName, { lane: "Account", resolve: getKontoSession, forbidden: KONTO_FORBIDDEN }, fn);
}

/**
 * The account page's spine: every change there is refused past the step-up window, whichever lane the
 * holder signs in by (`docs/frontend/spec.md :: I422`).
 */
export async function runKontoMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: (served: KontoSession) => Promise<T>,
): Promise<T | ActionFailure | StepUpRequired> {
  return runGuardedMutation(mutationName, { lane: "Account", resolve: getKontoSession, forbidden: KONTO_FORBIDDEN }, async (served) =>
    isFreshlySignedIn(served) ? fn(served) : stepUpRequired(),
  );
}
