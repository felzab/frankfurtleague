import { isRefusal } from "@/shared/utils/actionError";
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

/**
 * On the box, as the duplicate is, and with no repair: the grant in the way is changed on another page, by whoever
 * may. Said alike where the ban refuses it and where the list's read foresees the refusal.
 */
export const verwaltungAmFeld = (): { fieldErrors: FieldErrors } => ({
  fieldErrors: { email: "Diese Adresse gehört zur Verwaltung und lässt sich nicht sperren." },
});

/** `null` where the refusal is something else. It lands on the ADDRESS box, the only value the create sent. */
export function mapAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // Both codes: the rule refuses a second ban and `uniq_sperrliste_adresse_hash` refuses it again
  // where two administrators press together, so which of them answers is a race.
  if (error.serverErrorCode === "REQ-SPERRLISTE-001" || error.serverErrorCode === "DB-COMMON-002") {
    // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
    return { fieldErrors: { email: "Diese Adresse ist schon gesperrt." } };
  }

  if (error.serverErrorCode === "REQ-SPERRLISTE-002") {
    return { error: KEINE_SAISON };
  }

  if (error.serverErrorCode === "REQ-SPERRLISTE-003") return verwaltungAmFeld();

  return null;
}

/**
 * The list read's two refusals, `null` for the rest. Each refuses an address holding a grant, the administrator's own
 * (`REQ-PURGE-003`) or an owner's (`REQ-PURGE-005`), which the ban would refuse too: answered in the ban's words.
 */
export function mapAnsichtRefusal(error: unknown): { fieldErrors: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-PURGE-003" || error.serverErrorCode === "REQ-PURGE-005" ? verwaltungAmFeld() : null;
}
