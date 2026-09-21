import { APIBadStatusError } from "@/core/errors";

import type { FieldErrors } from "@/shared/utils/validation";

/** `null` where the 409 is something else. It lands on the ADDRESS box, the only value the create sent. */
export function mapAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  // Both codes: the rule refuses a second ban and `uniq_sperrliste_adresse_hash` refuses it again
  // where two administrators press together, so which of them answers is a race.
  if (error.serverErrorCode === "REQ-SPERRLISTE-001" || error.serverErrorCode === "DB-COMMON-002") {
    // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
    return { fieldErrors: { email: "Diese Adresse ist schon gesperrt." } };
  }

  return null;
}
