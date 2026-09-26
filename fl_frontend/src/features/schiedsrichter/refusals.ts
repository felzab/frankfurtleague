import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

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

/**
 * The anonymisation refusal, or `null` when the refusal is something else. It lands on no field: the
 * control is a dialog rather than a form.
 */
export function mapAnonymiseRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-ANONYMISE-004") {
    return buildRefusal({
      // The reader reached this by opening a link to the row every erased referee's fixtures point
      // at, so the repair names the referee they meant rather than a way to retry this one.
      reason: "Hinter diesem Eintrag steht keine Person, er sammelt nur die Spiele gelöschter Schiedsrichter",
      repair: "Öffne den Schiedsrichter, dessen Daten Du löschen willst",
    });
  }
  return null;
}

/**
 * The administrator's own sentence rather than a visitor's neutral one: every site raising it here
 * is admin-tier, and hiding the ban from the person who keeps the list hides it from the one reader
 * who can act on it.
 */
const ADRESSE_GESPERRT = buildRefusal({
  reason: "Diese E-Mail-Adresse steht auf der Sperrliste",
  repair: "Trage eine andere Adresse ein oder hebe die Sperre unter /bereich/admin/sperrliste auf",
});

/** `null` where the refusal is something else. The reactivation is a row's button, so the ban is a sentence and no box's. */
export function mapReactivateRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-SCHIEDSRICHTER-007" ? ADRESSE_GESPERRT : null;
}

/** `null` where the refusal is something else. It lands on the address box, which is the value the list refused. */
export function mapGesperrteAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "REQ-SCHIEDSRICHTER-007" ? { fieldErrors: { "kontakt.email": ADRESSE_GESPERRT } } : null;
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
      return ADRESSE_GESPERRT;
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
  repair: "Ein neuer Link führt auf keine Seite mehr; Änderungen an der Einwilligung nimmt die Person selbst vor",
});

/** Raised at the action as well, where the row already says so: a round trip to be told what the page can see is one nobody owes. */
export const KEINE_ADRESSE = buildRefusal({
  reason: "Für diese Person ist keine verwendbare E-Mail-Adresse hinterlegt",
  repair: "Trage oben eine E-Mail-Adresse ein und speichere",
});
