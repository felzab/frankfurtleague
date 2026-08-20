import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";

import type { FormState } from "@/shared/types/types";

/**
 * The Spiel refusals `fl_frontend/src/features/spiele/actions.ts :: mapSpielRefusal` does not map.
 * Three name an OCCUPANT and ride their code back for the form to place on the side at fault; the
 * two REQ-STATE codes name none and land as a toast.
 */
const OCCUPANT_REFUSALS: Record<string, string> = {
  // Three triggers: a re-dating or a changed Sonderereignis fires the rule as a new club does. The
  // walkover names its precondition because `REQ-STATE-003` is judged first, so offering one on an
  // unresolved slot would send an admin into a second refusal.
  "REQ-ELIGIBILITY-001":
    "Diese Mannschaft ist aus der Saison ausgeschieden und darf ab ihrem Austritt nicht mehr aufgestellt sein, auch wenn nur Datum oder Sonderereignis geändert wurde. Hebe den Austritt auf oder wähle eine andere Mannschaft; das Nichtantreten dieser Mannschaft kannst Du bei besetzten Plätzen eintragen, das Spiel absagen nur in der Gruppenphase.",

  "REQ-ELIGIBILITY-002": "Diese Mannschaft nimmt nicht an dieser Saison teil.",
  "REQ-STATE-002": "Ein Spiel mit diesem Sonderereignis wird nicht gewertet. Entferne zuerst die Tore.",
  "REQ-STATE-003": "Ein Nichtantreten braucht beide Mannschaften. Dieses Spiel hat noch einen offenen Platz.",
  "REQ-SPIELTAG-001":
    "Diese Mannschaft spielt am selben Spieltag bereits in einem anderen Spiel, dessen Aufstellung das System pflegt. Ändere dort die Herkunft, um die Mannschaft freizugeben.",
};

/**
 * Maps whatever a mutation threw onto the `FormState` the admin forms render. The messages are deliberately generic:
 * the diagnosis is already in the server log, and what the admin needs is whether retrying can help.
 */
export function toActionErrorResult(error: unknown): NonNullable<FormState> {
  if (error instanceof APIBadStatusError) {
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-001") {
      // The form does not offer these shapes, so the request was built against a season that has since moved.
      return {
        success: false,
        error: "Die Änderung passt nicht mehr zum aktuellen Turnierbaum, denn die Saison wurde inzwischen geändert. Lade die Seite neu.",
      };
    }
    if (error.statusCode === 409 && error.serverErrorCode !== undefined && error.serverErrorCode in OCCUPANT_REFUSALS) {
      // Unlike the wiring refusal above, reloading fixes none of these. The code rides back out so the
      // form can put the message on the side that caused it.
      return { success: false, error: OCCUPANT_REFUSALS[error.serverErrorCode], errorCode: error.serverErrorCode };
    }
    if (error.statusCode === 409) {
      // The ordinary outcome of a create hitting a unique index (DB-COMMON-002), possibly a retired row keeping its slot.
      return { success: false, error: "Der Eintrag steht im Konflikt mit einem, den es schon gibt." };
    }
    if (error.statusCode === 404) {
      return { success: false, error: "Der Eintrag wurde nicht gefunden. Vielleicht hat ihn jemand inzwischen gelöscht." };
    }
    return { success: false, error: "Der Server hat mit einem Fehler geantwortet. Versuche es erneut." };
  }

  if (error instanceof APINetworkError) {
    return {
      success: false,
      error: error.isTimeout
        ? "Zeitüberschreitung bei der Verbindung zum Server. Versuche es erneut."
        : "Der Server ist gerade nicht erreichbar. Versuche es später erneut.",
    };
  }

  if (error instanceof APIMalformedDataError) {
    return { success: false, error: "Die Daten kamen fehlerhaft an. Versuche es erneut." };
  }

  return { success: false, error: "Ein unerwarteter Fehler ist aufgetreten." };
}
