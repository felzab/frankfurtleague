import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";

import { buildRefusal, UNKNOWN_REFUSAL } from "./refusal";

import type { FormState } from "@/shared/types/types";

/**
 * The Spiel refusals `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal` does not map.
 * Three name an OCCUPANT and ride their code back for the form to place on the side at fault; the
 * two REQ-STATE codes name none and land as a toast.
 */
const OCCUPANT_REFUSALS: Record<string, string> = {
  // Three triggers: a re-dating or a changed Sonderereignis fires the rule as a new club does. Its
  // remedies ride the match editor's rail, from
  // `fl_frontend/src/features/spiele/components/forms/AdminEditSpielDataForm/banners.ts`.
  "REQ-ELIGIBILITY-001": "Dieses Team ist aus der Saison ausgeschieden und darf ab seinem Austritt nicht mehr aufgestellt sein.",

  "REQ-ELIGIBILITY-002": "Dieses Team nimmt nicht an dieser Saison teil.",
  "REQ-STATE-002": "Ein Spiel mit diesem Sonderereignis wird nicht gewertet. Entferne zuerst die Tore.",
  "REQ-STATE-003": "Ein Nichtantreten braucht beide Teams. Besetze zuerst den offenen Platz.",
  // The repair is on the OTHER fixture, so it rides the same rail rather than this field.
  "REQ-SPIELTAG-001": "Dieses Team spielt am selben Spieltag bereits in einem anderen Spiel.",
};

/**
 * Maps whatever a mutation threw onto the `FormState` the admin forms render. Each message names the way out rather
 * than the failure: the diagnosis is already in the server log, and the toast's title carries that the save is off.
 */
export function toActionErrorResult(error: unknown): NonNullable<FormState> {
  if (error instanceof APIBadStatusError) {
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-001") {
      // The form does not offer these shapes, so the request was built against a season that has since moved.
      return { success: false, error: "Die Saison wurde inzwischen geändert. Lade die Seite neu." };
    }
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-002") {
      // NOT the reload above: the form offered this answer and a reload only closes it, so what the
      // admin wanted needs a different source rather than a fresh page.
      return {
        success: false,
        error: buildRefusal({
          reason:
            "Eine Seite dieses Spiels hat als Herkunft einen Platz in einer Gruppe, und das ist nur in der ersten KO-Runde der Saison möglich",
          repair: "Wähle für diese Seite stattdessen ein früheres Spiel als Herkunft, oder setze das Team manuell",
        }),
      };
    }
    if (error.statusCode === 409 && error.serverErrorCode !== undefined && error.serverErrorCode in OCCUPANT_REFUSALS) {
      // Unlike the stale-form refusal above, reloading fixes none of these. The code rides back out
      // so the form can put the message on the side that caused it.
      return { success: false, error: OCCUPANT_REFUSALS[error.serverErrorCode], errorCode: error.serverErrorCode };
    }
    if (error.statusCode === 409) {
      // The ordinary outcome of a create hitting a unique index (DB-COMMON-002), possibly a retired row keeping its slot.
      return { success: false, error: "Der Eintrag steht im Konflikt mit einem, den es schon gibt." };
    }
    if (error.statusCode === 404) {
      return { success: false, error: "Der Eintrag wurde nicht gefunden. Lade die Seite neu." };
    }
    return { success: false, error: "Der Server hat mit einem Fehler geantwortet. Versuche es erneut." };
  }

  if (error instanceof APINetworkError) {
    return {
      success: false,
      error: error.isTimeout
        ? "Der Server hat zu lange nicht geantwortet. Versuche es erneut."
        : "Der Server ist gerade nicht erreichbar. Versuche es später erneut.",
    };
  }

  if (error instanceof APIMalformedDataError) {
    return { success: false, error: "Die Daten kamen fehlerhaft an. Versuche es erneut." };
  }

  return { success: false, error: UNKNOWN_REFUSAL };
}
