import type { FLSchiedsrichter } from "./schemas";

/* Whether a write may mint the referee a new link, a step-up write (`docs/frontend/spec.md :: I432`).
   Each is a SUPERSET of the backend's test, never a copy: a needless prompt costs a press, a missed
   one sends a credential unasked. */

type Stored = Pick<FLSchiedsrichter, "einwilligung" | "kontakt">;

const unanswered = (stored: Stored): boolean => (stored.einwilligung?.bestaetigt_am ?? null) === null;

/**
 * A save moving an unanswered referee's address, over
 * `fl_backend/app/api/schiedsrichter/services.py :: compose_korrektur_update`. The raw strings are
 * compared where the backend compares mailboxes: an address differing in case alone asks, harmlessly.
 */
export function saveMayMint(stored: Stored, email: string | null): boolean {
  return unanswered(stored) && email !== stored.kontakt.email;
}

/** A return from retirement of an unanswered referee, over `fl_backend/app/api/schiedsrichter/services.py :: owes_reactivation_mint`. */
export function returnMayMint(stored: Stored): boolean {
  return unanswered(stored);
}
