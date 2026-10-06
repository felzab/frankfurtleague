import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants";
import { isFunktionLost, isRefusal } from "@/shared/utils/actionError";

export const WAHL_GESPEICHERT = "Deine Wahl ist gespeichert";

export const WAHL_NICHT_GESPEICHERT = "Deine Wahl wurde nicht gespeichert";

// A page drawn before a new wording deployed, or before another press moved a choice, is refused, and
// only a reload draws what the press would be recorded against.
export const SEITE_VERALTET = "Diese Seite ist nicht mehr aktuell. Lade sie neu und wähle erneut.";

// The retyped floor rather than a served one: the floor is one constant for every record, and none of
// the account page's reads serve it (`fl_frontend/src/features/registrierungen/constants.ts :: MEDIEN_MIN_ALTER`).
export const MEDIEN_ZU_JUNG = `Fotos, Videos und Interviews kannst Du erst ab ${String(MEDIEN_MIN_ALTER)} Jahren erlauben.`;

// `REQ-FUNKTION-001` answers two causes alike on a record admitting a grant: the record is not the
// person's, or it refuses the grant pressed. The page offers a grant only where one is admitted, so
// either is a stale page.
export const EINTRAG_GEAENDERT =
  "Diese Angaben haben sich inzwischen geändert: Entweder sind sie nicht mehr bei Dir eingetragen, oder Du kannst hier nur noch etwas zurücknehmen. Lade die Seite neu.";

// The same code on a withdraw-only record, whose page offers no grant: the application is decided, or
// the person holds no seat on it.
export const BEWERBUNG_NICHT_MEHR_OFFEN =
  "Diese Bewerbung ist nicht mehr offen, oder Du bist in ihr nicht mehr eingetragen. Lade die Seite neu.";

// The same, on a pending registration: the team admitted or declined it, or it was deleted unadmitted.
export const REGISTRIERUNG_NICHT_MEHR_OFFEN =
  "Diese Registrierung ist nicht mehr offen. Lade die Seite neu, dort steht, was jetzt für Dich gilt.";

// A grant past the person's ceiling for the day (`REQ-DROSSELUNG-001`): the count starts again at
// German midnight, and a withdrawal is never counted, so the page says both.
export const ZUSTIMMEN_MORGEN = "Zustimmen kannst Du morgen wieder. Widerrufen geht jederzeit.";

/**
 * The one mapper every consent write shares: one code set behind one control, so a refusal reads the
 * same whichever record it refused. A lost seat and a barred address are the person spine's to word,
 * never this mapper's.
 */
export function mapEinwilligungWahlRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-EINWILLIGUNG-001":
    case "REQ-EINWILLIGUNG-003":
      return { error: SEITE_VERALTET };
    // The switch is offered only from the floor, so this reaches a page drawn before a birthdate was corrected.
    case "REQ-EINWILLIGUNG-002":
      return { error: MEDIEN_ZU_JUNG };
    // Only a grant is counted, so this reaches a press that would have switched a choice on.
    case "REQ-DROSSELUNG-001":
      return { error: ZUSTIMMEN_MORGEN };
    default:
      return null;
  }
}

/**
 * The consent writes on a record admitting a grant, a pupil's, a referee's or a season's seats: their
 * `REQ-FUNKTION-001` is worded here, ahead of the shared reader, whose sentence names a team.
 */
export function mapEigeneEinwilligungRefusal(error: unknown): { error: string } | null {
  if (isFunktionLost(error)) return { error: EINTRAG_GEAENDERT };
  return mapEinwilligungWahlRefusal(error);
}

/** A pending application's seats, which take a withdrawal alone: `mapEigeneEinwilligungRefusal` with that record's own cause. */
export function mapBewerbungEinwilligungRefusal(error: unknown): { error: string } | null {
  if (isFunktionLost(error)) return { error: BEWERBUNG_NICHT_MEHR_OFFEN };
  return mapEinwilligungWahlRefusal(error);
}

/** A pending registration, which takes a withdrawal alone, for `mapBewerbungEinwilligungRefusal`'s reason. */
export function mapRegistrierungEinwilligungRefusal(error: unknown): { error: string } | null {
  if (isFunktionLost(error)) return { error: REGISTRIERUNG_NICHT_MEHR_OFFEN };
  return mapEinwilligungWahlRefusal(error);
}
