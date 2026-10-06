import { isFunktionLost, isRefusal } from "@/shared/utils/actionError";

export const WAHL_GESPEICHERT = "Deine Wahl ist gespeichert";

export const WAHL_NICHT_GESPEICHERT = "Deine Wahl wurde nicht gespeichert";

// A page drawn before a new wording deployed, or before another press moved a choice, is refused, and
// only a reload draws what the press would be recorded against.
export const SEITE_VERALTET = "Diese Seite ist nicht mehr aktuell. Lade sie neu und wähle erneut.";

// No age named: the server action mapping the backend's refusal holds no entry to read the served floor
// from, and the switch's own paragraph, filled from it, names the age once the page is reloaded.
export const MEDIEN_ZU_JUNG = "Fotos, Videos und Interviews kannst Du in Deinem Alter noch nicht erlauben. Lade die Seite neu.";

// `REQ-FUNKTION-001` on a record admitting a grant: the address holds no such record of its own now.
export const EINTRAG_WEG = "Diese Angaben sind nicht mehr bei Dir eingetragen. Lade die Seite neu.";

// The same code on a pending application, whose page offers no grant: the application is decided, or
// the person holds no seat on it.
export const BEWERBUNG_NICHT_MEHR_OFFEN =
  "Diese Bewerbung ist nicht mehr offen, oder Du bist in ihr nicht mehr eingetragen. Lade die Seite neu.";

// The same, on a pending registration: the team admitted or declined it, or it was deleted unadmitted.
export const REGISTRIERUNG_NICHT_MEHR_OFFEN =
  "Diese Registrierung ist nicht mehr offen. Lade die Seite neu, dort steht, was jetzt für Dich gilt.";

// A grant on the person's own record that takes a withdrawal alone (`REQ-EINWILLIGUNG-004`): the page
// offers none there, so a page drawn before the record stopped admitting one sent it.
export const NUR_WIDERRUF = "Hier kannst Du eine Erlaubnis nur zurücknehmen. Lade die Seite neu.";

// A grant past the person's ceiling for the day (`REQ-DROSSELUNG-001`): the count starts again at
// German midnight, and a withdrawal is never counted, so the page says both.
export const ZUSTIMMEN_MORGEN = "Zustimmen kannst Du morgen wieder. Widerrufen geht jederzeit.";

/**
 * The code set every consent write shares: one set behind one control, so a refusal reads the same
 * whichever record it refused. A lost seat and a barred address are the person spine's to word, never
 * this mapper's.
 */
function mapEinwilligungWahlRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-EINWILLIGUNG-001":
    case "REQ-EINWILLIGUNG-003":
      return { error: SEITE_VERALTET };
    // The switch is offered only from the floor, so this reaches a page drawn before a birthdate was corrected.
    case "REQ-EINWILLIGUNG-002":
      return { error: MEDIEN_ZU_JUNG };
    case "REQ-EINWILLIGUNG-004":
      return { error: NUR_WIDERRUF };
    // Only a grant is counted, so this reaches a press that would have switched a choice on.
    case "REQ-DROSSELUNG-001":
      return { error: ZUSTIMMEN_MORGEN };
    default:
      return null;
  }
}

/**
 * One consent write's mapper: the shared code set, with the write's `REQ-FUNKTION-001` worded ahead of
 * the shared reader, whose sentence names a team, by the record the write changes.
 */
const einwilligungRefusalMapper =
  (eintragWeg: string) =>
  (error: unknown): { error: string } | null =>
    isFunktionLost(error) ? { error: eintragWeg } : mapEinwilligungWahlRefusal(error);

/** A pupil's, a referee's or a season's seats' consent write. */
export const mapEigeneEinwilligungRefusal = einwilligungRefusalMapper(EINTRAG_WEG);

/** A pending application's seats' consent write. */
export const mapBewerbungEinwilligungRefusal = einwilligungRefusalMapper(BEWERBUNG_NICHT_MEHR_OFFEN);

/** A pending registration's consent write. */
export const mapRegistrierungEinwilligungRefusal = einwilligungRefusalMapper(REGISTRIERUNG_NICHT_MEHR_OFFEN);
