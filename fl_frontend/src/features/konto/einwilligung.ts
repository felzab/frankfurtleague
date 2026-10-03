import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants";
import { isRefusal } from "@/shared/utils/actionError";

export const WAHL_GESPEICHERT = "Deine Wahl ist gespeichert";

export const WAHL_NICHT_GESPEICHERT = "Deine Wahl wurde nicht gespeichert";

// A grant names the page's running label, so a page drawn before a new wording deployed is refused,
// and only a reload draws the words the press would be recorded under.
export const SEITE_VERALTET = "Diese Seite ist nicht mehr aktuell. Lade sie neu und wähle erneut.";

// The retyped floor rather than a served one: the floor is one constant for every record, and none of
// the account page's reads serve it (`fl_frontend/src/features/registrierungen/constants.ts :: MEDIEN_MIN_ALTER`).
export const MEDIEN_ZU_JUNG = `Fotos, Videos und Interviews kannst Du erst ab ${String(MEDIEN_MIN_ALTER)} Jahren erlauben.`;

/**
 * The one mapper the three consent writes share: one code set behind one control, so a refusal reads
 * the same whichever record it refused. A lost seat and a barred address are the person spine's to
 * word, never this mapper's.
 */
export function mapEinwilligungWahlRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-EINWILLIGUNG-001":
      return { error: SEITE_VERALTET };
    // The switch is offered only from the floor, so this reaches a page drawn before a birthdate was corrected.
    case "REQ-EINWILLIGUNG-002":
      return { error: MEDIEN_ZU_JUNG };
    default:
      return null;
  }
}
