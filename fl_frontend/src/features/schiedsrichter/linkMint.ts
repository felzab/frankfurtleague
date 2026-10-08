import type { FLSchiedsrichter } from "./schemas";

/* Whether a write may mint the referee a new link, a step-up write (`docs/frontend/spec.md :: I432`).
   Each is a SUPERSET of the backend's test, never a copy: a needless prompt costs a press, a missed
   one sends a credential unasked. */

type Stored = Pick<FLSchiedsrichter, "einwilligung" | "kontakt">;

const unanswered = (stored: Stored): boolean => (stored.einwilligung?.bestaetigt_am ?? null) === null;

/**
 * A save moving any referee's address, a consent link or an address link alike, over
 * `fl_backend/app/api/schiedsrichter/services.py :: compose_korrektur_update`. Raw strings where the
 * backend compares mailboxes: a case-only difference asks, harmlessly.
 */
export function saveMayMint(stored: Stored, email: string | null): boolean {
  return email !== stored.kontakt.email;
}

/** A return from retirement of an unanswered referee, over `fl_backend/app/api/schiedsrichter/services.py :: owes_reactivation_mint`. */
export function returnMayMint(stored: Stored): boolean {
  return unanswered(stored);
}
