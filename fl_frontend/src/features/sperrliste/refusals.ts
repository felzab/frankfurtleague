import { APIBadStatusError } from "@/core/errors";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The league's own state, which no box on this form can repair: a banner, where the duplicate below
 * is a box. The administrator's way out is to activate a season, on another page entirely.
 */
const KEINE_SAISON = buildRefusal({
  reason: "Solange keine Saison läuft, lässt sich keine Adresse sperren",
  repair: "Aktiviere zuerst eine Saison",
});

/** `null` where the 409 is something else. It lands on the ADDRESS box, the only value the create sent. */
export function mapAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  // Both codes: the rule refuses a second ban and `uniq_sperrliste_adresse_hash` refuses it again
  // where two administrators press together, so which of them answers is a race.
  if (error.serverErrorCode === "REQ-SPERRLISTE-001" || error.serverErrorCode === "DB-COMMON-002") {
    // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
    return { fieldErrors: { email: "Diese Adresse ist schon gesperrt." } };
  }

  if (error.serverErrorCode === "REQ-SPERRLISTE-002") {
    return { error: KEINE_SAISON };
  }

  return null;
}
