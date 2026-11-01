import z from "zod";

import { isFunktionLost, isRefusal } from "@/shared/utils/actionError";

import type { Code } from "@/core/generated/client/types";

export const WAHL_GESPEICHERT = "Deine Wahl ist gespeichert";

export const WAHL_NICHT_GESPEICHERT = "Deine Wahl wurde nicht gespeichert";

// A page drawn before a new wording deployed, or before another press moved a choice, is refused, and
// only a reload draws what the press would be recorded against.
export const SEITE_VERALTET = "Diese Seite ist nicht mehr aktuell. Lade sie neu und wähle erneut.";

/**
 * `alter` is the media floor the record's entry serves, never a number of the page's own: one would name
 * another age the day the backend's rule moves.
 */
export const medienZuJung = (alter: number): string => `Fotos, Videos und Interviews kannst Du erst ab ${String(alter)} Jahren erlauben.`;

/**
 * The served media floor's one shape: the account page's read, the three public confirmation views' reads,
 * and the argument a granting control binds to its write, which only words `medienZuJung`. A floor the
 * writes refuse fails every read.
 */
export const MedienMindestalterSchema = z.int().positive();

// `role_not_held` on a record admitting a grant: the address holds no such record of its own now.
export const EINTRAG_WEG = "Diese Angaben sind nicht mehr bei Dir eingetragen. Lade die Seite neu.";

// The same code on a pending application, whose page offers no grant: the application is decided, or
// the person holds no seat on it.
export const BEWERBUNG_NICHT_MEHR_OFFEN =
  "Diese Bewerbung ist nicht mehr offen, oder Du bist in ihr nicht mehr eingetragen. Lade die Seite neu.";

// The same, on a pending registration: the team admitted or declined it, or it was deleted unadmitted.
export const REGISTRIERUNG_NICHT_MEHR_OFFEN =
  "Diese Registrierung ist nicht mehr offen. Lade die Seite neu. Dort steht, was jetzt für Dich gilt.";

// A grant on the person's own record that takes a withdrawal alone (`giving_not_allowed`): the page
// offers none there, so a page drawn before the record stopped admitting one sent it, and a refused write
// never refreshes the page.
export const NUR_WIDERRUF = "Hier kannst Du eine Erlaubnis nur zurücknehmen. Lade die Seite neu.";

/**
 * The code set every consent write shares, each with its sentence, so a refusal reads the same whichever
 * record it refused; a lost seat and a barred address are the person spine's. Exported for the
 * publication sweep.
 */
export const EINWILLIGUNG_WAHL_SAETZE: Readonly<Record<string, string>> = {
  wording_not_allowed: SEITE_VERALTET,
  giving_not_allowed: NUR_WIDERRUF,
} satisfies Partial<Record<Code, string>>;

function mapEinwilligungWahlRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error) || error.serverErrorCode === undefined) return null;
  // Own keys alone, so a code spelling an inherited member never reads as worded.
  const satz = Object.hasOwn(EINWILLIGUNG_WAHL_SAETZE, error.serverErrorCode) ? EINWILLIGUNG_WAHL_SAETZE[error.serverErrorCode] : undefined;

  return satz === undefined ? null : { error: satz };
}

/**
 * One consent write's mapper: the shared code set, with the write's `role_not_held` worded ahead of
 * the shared reader, whose sentence names a team, by the record the write changes.
 */
const einwilligungRefusalMapper =
  (eintragWeg: string) =>
  (error: unknown): { error: string } | null =>
    isFunktionLost(error) ? { error: eintragWeg } : mapEinwilligungWahlRefusal(error);

const mapEigeneWahlRefusal = einwilligungRefusalMapper(EINTRAG_WEG);

/** A pupil's, a referee's or a season's seats' consent write, the three taking a grant, by its record's served media floor. */
export function mapEigeneEinwilligungRefusal(error: unknown, medienMindestalter: number): { error: string } | null {
  // The switch is offered only from the floor, so this reaches a page drawn before a birthdate was corrected.
  if (isRefusal(error) && error.serverErrorCode === "medien_age") {
    return { error: `${medienZuJung(medienMindestalter)} Lade die Seite neu.` };
  }

  return mapEigeneWahlRefusal(error);
}

/** A pending application's seats' consent write. */
export const mapBewerbungEinwilligungRefusal = einwilligungRefusalMapper(BEWERBUNG_NICHT_MEHR_OFFEN);

/** A pending registration's consent write. */
export const mapRegistrierungEinwilligungRefusal = einwilligungRefusalMapper(REGISTRIERUNG_NICHT_MEHR_OFFEN);
