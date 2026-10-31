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

/**
 * No repair sentence: the box carrying the message is itself the way out. Said alike where
 * the ban refuses a second ban and where the list's read finds one standing.
 */
export const schonGesperrtAmFeld = (): { fieldErrors: FieldErrors } => ({ fieldErrors: { email: "Diese Adresse ist schon gesperrt." } });

/** `null` where the refusal is something else. A refusal of the address lands on its box. */
export function mapSperreRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // The rule refuses a second ban, and `uniq_sperrliste_adresse_hash` refuses it again where two
  // administrators press together: one code for both.
  if (error.serverErrorCode === "duplicate_key") return schonGesperrtAmFeld();

  if (error.serverErrorCode === "sperrliste_no_saison") {
    return { error: KEINE_SAISON };
  }

  if (error.serverErrorCode === "sperrliste_verwaltung") return verwaltungAmFeld();

  return null;
}

/**
 * The list read's two refusals, `null` for the rest. Each refuses a grant holder's address, the administrator's own
 * (`own_adresse`) or, to one holding no owner's power, any other (`verwaltung_adresse`), which the ban would refuse too:
 * answered in the ban's words.
 */
export function mapAnsichtRefusal(error: unknown): { fieldErrors: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "own_adresse" || error.serverErrorCode === "verwaltung_adresse" ? verwaltungAmFeld() : null;
}
