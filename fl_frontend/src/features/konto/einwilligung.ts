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
  "Diese Registrierung ist nicht mehr offen. Lade die Seite neu. Dort steht, was jetzt für Dich gilt.";

// A grant on the person's own record that takes a withdrawal alone (`REQ-EINWILLIGUNG-004`): the page
// offers none there, so a page drawn before the record stopped admitting one sent it.
export const NUR_WIDERRUF = "Hier kannst Du eine Erlaubnis nur zurücknehmen. Lade die Seite neu.";

// A grant past the person's ceiling for the day (`REQ-DROSSELUNG-001`): the count starts again at
// German midnight, and a withdrawal is never counted, so the page says both.
export const ZUSTIMMEN_MORGEN = "Zustimmen kannst Du morgen wieder. Widerrufen geht jederzeit.";

/**
 * The code set every consent write shares, each with its sentence, so a refusal reads the same whichever
 * record it refused; a lost seat and a barred address are the person spine's. Exported for the
 * publication sweep.
 */
export const EINWILLIGUNG_WAHL_SAETZE: Readonly<Record<string, string>> = {
  "REQ-EINWILLIGUNG-001": SEITE_VERALTET,
  "REQ-EINWILLIGUNG-003": SEITE_VERALTET,
  // The switch is offered only from the floor, so this reaches a page drawn before a birthdate was corrected.
  "REQ-EINWILLIGUNG-002": MEDIEN_ZU_JUNG,
  "REQ-EINWILLIGUNG-004": NUR_WIDERRUF,
  // Only a grant is counted, so this reaches a press that would have switched a choice on.
  "REQ-DROSSELUNG-001": ZUSTIMMEN_MORGEN,
};

function mapEinwilligungWahlRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error) || error.serverErrorCode === undefined) return null;
  // Own keys alone, so a code spelling an inherited member never reads as worded.
  const satz = Object.hasOwn(EINWILLIGUNG_WAHL_SAETZE, error.serverErrorCode) ? EINWILLIGUNG_WAHL_SAETZE[error.serverErrorCode] : undefined;

  return satz === undefined ? null : { error: satz };
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
