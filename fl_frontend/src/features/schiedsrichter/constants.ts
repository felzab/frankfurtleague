import { PLACEHOLDER } from "@/shared/utils/format";

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
 * What a reader is shown where the erasure nulled the name. It lives here and in no stored document,
 * so rewording it reaches every surface at once and moves no data.
 */
export const SCHIEDSRICHTER_ANONYM_LABEL = "anonym";

/**
 * The one row an erasure repoints its fixtures at, mirroring
 * `fl_backend/app/core/sentinels.py :: GHOST_SCHIEDSRICHTER_ID`. Every admin by-id route answers 404
 * for it, so nothing reads it back: it names the fixtures of erased referees, in one link.
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
 * Every surface rendering a referee's name reads it through here, so no cell, chip, tooltip or
 * aria-label can be the one that shows an empty space where a name was.
 */
export function schiedsrichterAnzeigename(name: string | null): string {
  return name ?? SCHIEDSRICHTER_ANONYM_LABEL;
}

/**
 * The word a FIXTURE's referee cell shows.
 *
 * One helper because the obvious spelling reads both absences through one chain —
 * `schiedsrichter?.name ?? PLACEHOLDER.entity` — which falls through to the no-referee placeholder for
 * an erased referee the fixture does hold.
 */
export function spielSchiedsrichterAnzeige(schiedsrichter: { name: string | null } | null): string {
  return schiedsrichter === null ? PLACEHOLDER.entity : schiedsrichterAnzeigename(schiedsrichter.name);
}
