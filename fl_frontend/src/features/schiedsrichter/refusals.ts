import { ADRESSWECHSEL_EINTRAG } from "@/features/admin/constants";
import { SPERRLISTE_ADRESSE_GESPERRT, SPERRLISTE_ADRESSE_GESPERRT_FELD } from "@/features/sperrliste/constants";
import { isRefusal, KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * `null` where the refusal is something else. It lands on the NAME box: `uniq_schiedsrichter_name` is this
 * collection's only unique index, so the code can be about no other value the create or the edit sent.
 */
export function mapNameRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
  if (error.serverErrorCode === "DB-COMMON-002") {
    return { fieldErrors: { name: "Diesen Namen gibt es schon." } };
  }
  return null;
}

/** `null` where the refusal is something else; it lands on no field, the retire control being a dialog. */
export function mapRetireRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-RETIRE-004") {
    return buildRefusal({
      reason: "Diese Person ist noch für Spiele eingeteilt, die kein Ergebnis haben",
      repair: "Teile die Spiele jemand anderem zu oder sage sie ab",
    });
  }
  return null;
}

/** `null` where the refusal is something else. The reactivation is a row's button, so the ban is a sentence and no box's. */
export function mapReactivateRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-SCHIEDSRICHTER-007" ? SPERRLISTE_ADRESSE_GESPERRT : null;
}

/** `null` where the refusal is something else. It lands on the address box, which is the value the list refused. */
export function mapGesperrteAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-SCHIEDSRICHTER-007" ? { fieldErrors: { "kontakt.email": SPERRLISTE_ADRESSE_GESPERRT_FELD } } : null;
}

/** The re-send's own two refusals, or `null`. Neither lands on a field: the control is a panel button, not a form. */
export function mapEinladenRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-SCHIEDSRICHTER-001":
      return buildRefusal({
        // A retired row takes no booking, so what the link would collect is consent for a role
        // nobody can give this person.
        reason: "Diese Person ist stillgelegt und wird zu keinem Spiel mehr eingeteilt",
        repair: "Reaktiviere den Eintrag, bevor Du einen Link sendest",
      });
    case "REQ-SCHIEDSRICHTER-004":
      return SCHON_BESTAETIGT;
    case "REQ-SCHIEDSRICHTER-006":
      return KEINE_ADRESSE;
    case "REQ-SCHIEDSRICHTER-007":
      return SPERRLISTE_ADRESSE_GESPERRT;
    default:
      return null;
  }
}

/**
 * Raised at the control as well, where the panel beside it already shows the answer: the endpoint
 * refuses a second link for a person who has confirmed, there being no page left for them to open.
 */
const SCHON_BESTAETIGT = buildRefusal({
  reason: "Diese Person hat ihren Eintrag schon bestätigt",
  repair: "Ein neuer Link führt auf keine Seite mehr. Änderungen an der Einwilligung nimmt die Person selbst vor",
});

/** Raised at the action as well, where the row already says so: a round trip to be told what the page can see is one nobody owes. */
export const KEINE_ADRESSE = buildRefusal({
  reason: "Für diese Person ist keine verwendbare E-Mail-Adresse hinterlegt",
  repair: "Trage oben eine E-Mail-Adresse ein und speichere",
});

/**
 * The save's refusal to move a confirmed referee's address, which only a page older than the record sends: one opened
 * before the confirmation, or before an address change moved the address it carries back unedited.
 */
export function mapBestaetigteAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-SCHIEDSRICHTER-011" ? { error: BESTAETIGTE_ADRESSE } : null;
}

// Both causes named: on the second the administrator touched no address, so the rule alone explains a change they never made.
const BESTAETIGTE_ADRESSE = buildRefusal({
  reason: `Seit Du die Seite geöffnet hast, hat die Person bestätigt oder ihre Adresse hat sich geändert. Die Adresse einer bestätigten Schiedsrichterin oder eines bestätigten Schiedsrichters ändert die Person selbst in ihrem Konto oder die Verwaltung unter „${ADRESSWECHSEL_EINTRAG.label}“`,
  repair: LADE_DIE_SEITE_NEU,
});

/** Worded for the undo: the save's own sentences send an admin to a form this toast has not got. */
export const SCHIEDSRICHTER_REPLAY_REFUSALS: Readonly<Record<string, string>> = {
  "REQ-SCHIEDSRICHTER-007":
    "Die frühere E-Mail-Adresse steht auf der Sperrliste, und zurückschreiben würde ihr einen neuen Bestätigungslink schicken.",
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
  // Both causes, as `BESTAETIGTE_ADRESSE` names them: an address change landing inside the undo window refuses the
  // replay of a referee confirmed throughout, who would otherwise read as having just confirmed.
  "REQ-SCHIEDSRICHTER-011": `Seit dem Speichern hat die Person bestätigt oder ihre Adresse hat sich geändert. Ihre Adresse ändert sie jetzt selbst in ihrem Konto oder die Verwaltung unter „${ADRESSWECHSEL_EINTRAG.label}“.`,
};
