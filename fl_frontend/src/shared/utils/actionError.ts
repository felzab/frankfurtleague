/**
 * SHARED · thrown error → action result
 *
 * The pure half of `serverAction.ts`: maps whatever a mutation threw onto the `FormState` result
 * shape the admin forms render. Split out so the unit tests can cover the mapping — this module
 * imports no config and nothing `server-only`.
 *
 * The messages are deliberately generic German: the specific diagnosis (status, backend error code,
 * correlation id, zod issues) belongs to the server log, which `serverAction.ts` writes before this
 * mapping runs. What the admin needs is whether retrying can help.
 */

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";

import type { FormState } from "@/shared/types/types";

/**
 * The three occupant refusals the match write path answers, and what each means in German (ADR-0042).
 *
 * These are the exception to this module's "deliberately generic" rule, and the reason is that they
 * are the only failures here an admin can fix from the form they are already looking at: pick a
 * different team, or free the fixture the team is currently in. A generic "der Server hat mit einem
 * Fehler geantwortet" would send them to reload a page whose state is perfectly current.
 *
 * Mirrors `fl_backend/app/api/spiele/services.py :: ELIGIBILITY_DISQUALIFIED` and its two siblings.
 */
const OCCUPANT_REFUSALS: Record<string, string> = {
  "REQ-ELIGIBILITY-001": "Diese Mannschaft ist für die Saison disqualifiziert und kann nicht aufgestellt werden.",
  "REQ-ELIGIBILITY-002": "Diese Mannschaft nimmt nicht an dieser Saison teil.",
  "REQ-SPIELTAG-001":
    "Diese Mannschaft spielt am selben Spieltag bereits in einem anderen Spiel, dessen Aufstellung das System pflegt. Ändere dort die Herkunft, um die Mannschaft freizugeben.",
};

export function toActionErrorResult(error: unknown): NonNullable<FormState> {
  if (error instanceof APIBadStatusError) {
    if (error.statusCode === 409 && error.serverErrorCode === "REQ-WIRING-001") {
      // The write path refused bracket wiring the season cannot hold (ADR-0038). The form does not
      // offer these shapes, so the request was built against a season that has moved. Reloading is
      // the fix.
      return {
        success: false,
        error: "Die Änderung passt nicht mehr zum aktuellen Turnierbaum, denn die Saison wurde inzwischen geändert. Lade die Seite neu.",
      };
    }
    if (error.statusCode === 409 && error.serverErrorCode !== undefined && error.serverErrorCode in OCCUPANT_REFUSALS) {
      // A team the season cannot hold in the fixture the payload puts it in (ADR-0042). Unlike the
      // wiring refusal above, reloading fixes none of these. The code rides back out so the form can
      // put the message on the side that caused it.
      return { success: false, error: OCCUPANT_REFUSALS[error.serverErrorCode], errorCode: error.serverErrorCode };
    }
    if (error.statusCode === 409) {
      // The ordinary outcome of a create hitting a unique index (DB-COMMON-002, ADR-0025): the
      // record conflicts with one that exists -- possibly a retired row keeping its slot.
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
