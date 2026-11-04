// Redesign: goes with its last importer.
import { isFreshlySignedIn } from "@/core/auth/sessionStamps";
import { ENROLMENT_WINDOW_MS, isWithinEnrolmentWindow, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes";

import type { JudgedSession } from "@/core/auth/guards";
import type { ConfirmedUntil } from "@/shared/hooks/useConfirmationWindows";

/**
 * Whether the served session is the one the page was drawn for: a confirmation made once the page's
 * session has ended answers a challenge naming nobody, and can sign another account in.
 */
export function isHeldBy(served: { readonly user: { readonly id: string } }, holderId: string): boolean {
  return served.user.id === holderId;
}

/** Until when the served session counts as confirmed, as epoch milliseconds, or `null` where it already does not. */
function freshUntil(served: JudgedSession): number | null {
  return isFreshlySignedIn(served) ? new Date(served.session.createdAt).getTime() + STEP_UP_WINDOW_MS : null;
}

/**
 * Until when the served session may add a passkey, or `null` where it already may not: the enrolment
 * guard's narrower window, inside the confirmation every change takes.
 */
function enrolmentUntil(served: JudgedSession): number | null {
  if (!isFreshlySignedIn(served) || !isWithinEnrolmentWindow(served.session.createdAt)) return null;
  return new Date(served.session.createdAt).getTime() + ENROLMENT_WINDOW_MS;
}

/** What a page's step-up is served, on both surfaces: no figure reaches a page without the clock it was read on. */
export function confirmedUntil(served: JudgedSession): ConfirmedUntil {
  return { freshUntil: freshUntil(served), enrolmentUntil: enrolmentUntil(served), servedAt: Date.now() };
}
