// Its own module: every export of a `"use client"` view becomes a client reference.
export const SCHIEDSRICHTER_CRUD_COPY = {
  searchLabel: "Schiedsrichter suchen",
  searchPlaceholder: "z.B. Pierluigi Collina oder Goethe-Gymnasium",
} as const;

/**
 * What a reader is shown where the erasure nulled the name. It lives here and in no stored document,
 * so rewording it reaches every surface at once and moves no data — and never becomes a value
 * anything matches on: the facet's merged option carries
 * `fl_frontend/src/features/spiele/facets.ts :: ANONYMISED_SCHIEDSRICHTER_VALUE` instead.
 *
 * Not a first name, which beside a date and a club still identifies one person in a league this
 * size, and not „Schiedsrichter“, which reads oddly in a column already headed with it.
 */
export const SCHIEDSRICHTER_ANONYM_LABEL = "anonym";

/**
 * Every surface rendering a referee's name reads it through here, so no cell, chip, tooltip or
 * aria-label can be the one that shows an empty space where a name was.
 */
export function schiedsrichterAnzeigename(name: string | null): string {
  return name ?? SCHIEDSRICHTER_ANONYM_LABEL;
}
