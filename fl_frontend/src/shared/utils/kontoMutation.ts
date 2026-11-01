// Redesign: goes with its last importer.
import { getKontoSession, isFreshlySignedIn } from "@/core/auth";
import { ENROLMENT_WINDOW_MS, isWithinEnrolmentWindow, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import { ANMELDUNG_ABGELAUFEN } from "./actionError";
import { runGuardedMutation, stepUpRequired } from "./adminMutation";

import type { ConfirmedUntil } from "@/shared/hooks/useConfirmationWindows";
import type { ActionFailure } from "@/shared/types/types";
import type { StepUpRequired } from "./adminMutation";

/** The signed-in holder of the account page, in either lane; never the row's `token`. */
export type KontoSession = NonNullable<Awaited<ReturnType<typeof getKontoSession>>>;

/**
 * Whether the served session is the one the page was drawn for: a confirmation made once the page's
 * session has ended answers a challenge naming nobody, and can sign another account in.
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
 * guard's narrower window, inside the confirmation every change takes.
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
 * The account page's guard without the step-up window, for a press that only mails the holder's own
 * mailbox: the code that renews the window, and the deletion link.
 */
export async function runKontoStepUp<T extends { success: boolean }>(
  mutationName: string,
  fn: (served: KontoSession) => Promise<T>,
): Promise<T | ActionFailure> {
  return runGuardedMutation(mutationName, { lane: "Account", resolve: getKontoSession, forbidden: ANMELDUNG_ABGELAUFEN }, fn);
}

/**
 * The account page's spine: every change there is refused past the step-up window, whichever lane the
 * holder signs in by.
 */
export async function runKontoMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: (served: KontoSession) => Promise<T>,
): Promise<T | ActionFailure | StepUpRequired> {
  return runGuardedMutation(mutationName, { lane: "Account", resolve: getKontoSession, forbidden: ANMELDUNG_ABGELAUFEN }, async (served) =>
    isFreshlySignedIn(served) ? fn(served) : stepUpRequired(),
  );
}
