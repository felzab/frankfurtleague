import { SCHIEDSRICHTER_EINWILLIGUNG } from "@/core/einwilligung";
import { BEWERBUNG_MAX_ALTER } from "@/features/bewerbungen/constants";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { FLEinwilligung } from "@/features/spieler/schemas";

// Its own module: every export of a `"use client"` view becomes a client reference.
export const SCHIEDSRICHTER_CRUD_COPY = {
  searchLabel: "Schiedsrichter suchen",
  searchPlaceholder: "z.B. Pierluigi Collina oder Goethe-Gymnasium",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Neuen Schiedsrichter anlegen",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Schiedsrichter für diese Suche.",
  emptyForFilters: "Keine Schiedsrichter für diese Filter.",
  emptyOverall: "Es wurden noch keine Schiedsrichter angelegt.",
} as const;

// Not a first name, which beside a date and a club still identifies one person in a league this
// size, and not „Schiedsrichter“, which reads oddly in a column already headed with it.
/**
 * What a reader is shown where an erasure, or the one-off drop of the referee rows older than the
 * confirmation link, nulled the name. Stored nowhere, so a rewording reaches every surface at once and
 * moves no data.
 */
export const SCHIEDSRICHTER_ANONYM_LABEL = "anonym";

/**
 * The one row an erasure, and the one-off drop of the referee rows older than the confirmation link,
 * repoint fixtures at, mirroring `fl_backend/app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`. Every
 * admin by-id route answers 404 for it, so nothing reads it back.
 */
export const GHOST_SCHIEDSRICHTER_ID = "000000000000000000000000";

/**
 * What names a row a hand-write left nameless, where the erasure's word above would claim a deletion
 * that never ran. The list's controls and the editor's header say it alike, so one state has one word.
 */
export const SCHIEDSRICHTER_OHNE_NAMEN_LABEL = "Eintrag ohne Namen";

/**
 * Neutral throughout: the published notice writes „Schiedsrichterinnen und Schiedsrichter“, so a
 * masculine pronoun here names the wrong person for half the people the league books.
 */
export const SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE =
  "Schon eingetragene Spiele behalten diese Person. Für neue Spiele steht sie nicht mehr zur Auswahl.";

/**
 * Mirrored from `fl_backend/app/shared/schemas/bounds.py`, so the dead-link panel states the day the
 * endpoint refuses on. Fourteen rather than the registration's seven: this link waits on an adult
 * with no second route in.
 */
export const SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE = 14;

// Retyped from `fl_backend/app/shared/schemas/bounds.py` for the published notice, which states the
// floor with no answer to read it off. The confirmation page still takes the served `mindestalter`:
// a page judging a date against this copy would refuse where the endpoint accepts.
export const SCHIEDSRICHTER_MIN_ALTER = 16;

// „intern“ is the consent text's own word for the second answer, so the chip carries it rather than
// a paraphrase a reader would have to match to the paragraph above it.
/** The publication question. The answers are the registry's, this choice deciding a stored field. */
export const SCHIEDSRICHTER_UMFANG_FRAGE = "Was darf im Spielplan von Deinem Namen stehen?";

// Both bounds, never the floor alone: named for the floor, a mistyped year would answer a
// 190-year-old date with „mindestens 16“, which is a different fault.

// The pupil's sentence word for word, and NOT the contact seat's: the two public consent pages ask
// one person one question, and `fl_backend/app/shared/alter.py` judges both by the same span.
export const alterAusserhalb = (mindestalter: number): string =>
  `Du musst mindestens ${String(mindestalter)} und höchstens ${String(BEWERBUNG_MAX_ALTER)} Jahre alt sein. Prüfe Dein Geburtsdatum.`;

export const SCHIEDSRICHTER_UMFANG_OPTIONS: readonly { value: FLEinwilligung["umfang"]; label: string }[] = [
  { value: "kader_oeffentlich", label: SCHIEDSRICHTER_EINWILLIGUNG.bedienelemente.kader_oeffentlich },
  { value: "intern", label: SCHIEDSRICHTER_EINWILLIGUNG.bedienelemente.intern },
];

/**
 * What a referee agreed may be PUBLISHED. Not `@/features/spieler/constants :: EINWILLIGUNG_UMFANG_LABELS`,
 * whose „Kader“ names a squad a referee is in no row of: one stored slug, two surfaces a reader sees.
 */
export const SCHIEDSRICHTER_UMFANG_LABELS: Record<FLEinwilligung["umfang"], string> = {
  kader_oeffentlich: "Name im Spielplan",
  intern: "Nur innerhalb der Liga",
};

/**
 * `false` is read as nobody having agreed rather than as a refusal: the switch is off until somebody
 * presses it, and a word naming a decision would put one in that person's mouth.
 */
export const SCHIEDSRICHTER_MEDIEN_LABELS = {
  erteilt: "Fotos, Videos und Interviews zugesagt",
  nicht_erteilt: "Nicht zugesagt",
} as const;

/**
 * Stated in the editor because no control shows it: an administrator correcting an outstanding
 * referee's address sends a link from the save bar, and would otherwise look for a press that mails it.
 */
export const SCHIEDSRICHTER_KORREKTUR_HINWEIS =
  "Solange diese Person nicht bestätigt hat, geht beim Speichern einer geänderten E-Mail-Adresse " +
  "automatisch ein neuer Link an die neue Adresse, und der bisherige gilt nicht mehr.";

/**
 * The two states that close the send, worded for the administrator at the control rather than left
 * to the round trip that `REQ-SCHIEDSRICHTER-001` and `-006` answer with.
 */
export const SCHIEDSRICHTER_EINLADEN_OHNE_ADRESSE = "Trage zuerst eine E-Mail-Adresse ein und speichere.";
export const SCHIEDSRICHTER_EINLADEN_STILLGELEGT = "Reaktiviere den Eintrag, bevor Du einen Link sendest.";

/**
 * **The id decides, never the null name alone**: one nameless booking is the ghost and the other a
 * person still in the league, and one word for both reports a teacher as deleted.
 */
export function bookedSchiedsrichterName({ schiedsrichter_id, name }: { schiedsrichter_id: string; name: string | null }): string {
  if (name !== null) return name;

  return schiedsrichter_id === GHOST_SCHIEDSRICHTER_ID ? SCHIEDSRICHTER_ANONYM_LABEL : SCHIEDSRICHTER_OHNE_NAMEN_LABEL;
}

/**
 * A SECOND spelling of the rule the confirmation read applies to the same stored `name`, no mint
 * response answering a forename: the two differing would greet a referee by one name and title
 * their page with another.
 */
export function schiedsrichterVorname(name: string | null): string | null {
  const erster = (name ?? "").trim().split(/\s+/u)[0] ?? "";

  return erster === "" ? null : erster;
}

/**
 * The word a FIXTURE's referee cell shows.
 *
 * Its own helper because the obvious spelling reads both absences through one chain —
 * `schiedsrichter?.name ?? PLACEHOLDER.entity` — which falls through to the no-referee placeholder for
 * a fixture that does hold one.
 */
export function spielSchiedsrichterAnzeige(schiedsrichter: { schiedsrichter_id: string; name: string | null } | null): string {
  return schiedsrichter === null ? PLACEHOLDER.entity : bookedSchiedsrichterName(schiedsrichter);
}
