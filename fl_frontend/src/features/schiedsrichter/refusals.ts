import { isRecordMissing } from "@/core/errors";
import { SPERRLISTE_ADRESSE_GESPERRT, SPERRLISTE_ADRESSE_GESPERRT_FELD } from "@/features/sperrliste/constants";
import { ADRESSE_AENDERN } from "@/features/spieler/constants";
import { ADRESSE_BELEGT, NAME_IM_GRUND, SCHON_HINTERLEGT } from "@/features/spieler/refusals";
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
 * The save's refusal to move a confirmed referee's address, which only a page older than the confirmation
 * sends: the editor shows that address read-only beside its own control.
 */
export function mapBestaetigteAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-SCHIEDSRICHTER-011" ? { error: BESTAETIGTE_ADRESSE } : null;
}

const BESTAETIGTE_ADRESSE = buildRefusal({
  reason: `Die Adresse einer bestätigten Schiedsrichterin oder eines bestätigten Schiedsrichters ändert sich nur über „${ADRESSE_AENDERN}“`,
  repair: LADE_DIE_SEITE_NEU,
});

/**
 * An administrator's start of a change, or `null`, in the pupil's words where the rule is the pupil's:
 * the address's own refusals land on the box that holds it, the reason's on the reason box.
 */
export function mapAdresswechselAntragRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (isRecordMissing(error)) return { error: EINTRAG_GELOESCHT };
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // A page older than a correction that left the row unconfirmed: reloaded, it shows the save's own address box.
    case "REQ-SCHIEDSRICHTER-014":
      return { error: NOCH_NICHT_BESTAETIGT };
    case "REQ-SCHIEDSRICHTER-006":
      return { error: KEINE_ADRESSE };
    case "REQ-SCHIEDSRICHTER-007":
      return { error: SPERRLISTE_ADRESSE_GESPERRT, fieldErrors: { email: SPERRLISTE_ADRESSE_GESPERRT_FELD } };
    case "REQ-SCHIEDSRICHTER-012":
      return { error: SCHON_HINTERLEGT, fieldErrors: { email: SCHON_HINTERLEGT } };
    case "REQ-SCHIEDSRICHTER-013":
      return { error: NAME_IM_GRUND, fieldErrors: { grund: NAME_IM_GRUND } };
    // A pupil row at the replaced address would move onto an address another pupil signs in on.
    case "REQ-SPIELER-006":
      return { error: ADRESSE_BELEGT, fieldErrors: { email: ADRESSE_BELEGT } };
    default:
      return null;
  }
}

const EINTRAG_GELOESCHT = buildRefusal({ reason: "Diesen Eintrag gibt es nicht mehr", repair: LADE_DIE_SEITE_NEU });

const NOCH_NICHT_BESTAETIGT = buildRefusal({
  reason: "Diese Person hat ihren Eintrag noch nicht bestätigt, deshalb änderst Du ihre Adresse im Feld oben und speicherst",
  repair: LADE_DIE_SEITE_NEU,
});

/**
 * The pending address change's two controls, or `null`. A change answered, replaced or discarded
 * since the page loaded is the 404 both answer, and the page holding a stale panel is the repair.
 */
export function mapAdresswechselRefusal(error: unknown): string | null {
  if (isRecordMissing(error)) return KEIN_ADRESSWECHSEL;
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-SCHIEDSRICHTER-007":
      return SPERRLISTE_ADRESSE_GESPERRT;
    // The panel has no box, so the sentence names the two ways out it does hold.
    case "REQ-SPIELER-006":
      return `${ADRESSE_BELEGT} Verwirf die Änderung oder gib unter „${ADRESSE_AENDERN}“ eine andere ein.`;
    default:
      return null;
  }
}

// A re-send is offered only while the new mailbox is asked, so its 404 is a page older than an answer,
// an approval still owed or a waiting time begun.
const KEIN_ADRESSWECHSEL = buildRefusal({
  reason: "Für diese Person wartet keine neue E-Mail-Adresse mehr auf ihre Bestätigung",
  repair: LADE_DIE_SEITE_NEU,
});

/** Worded for the undo: the save's own sentences send an admin to a form this toast has not got. */
export const SCHIEDSRICHTER_REPLAY_REFUSALS: Readonly<Record<string, string>> = {
  "REQ-SCHIEDSRICHTER-007":
    "Die frühere E-Mail-Adresse steht auf der Sperrliste, und zurückschreiben würde ihr einen neuen Bestätigungslink schicken.",
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
  // Confirmed between the save and its undo: the address the replay would write back moves only by a change.
  "REQ-SCHIEDSRICHTER-011": `Die Person hat inzwischen bestätigt, und ihre Adresse ändert sich nur über „${ADRESSE_AENDERN}“.`,
};
