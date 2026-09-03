import type { FLSaisonRules, FLSpielplanShape } from "@/features/saisons/schemas";

/** One of the three, as the panel both offers and reads it back. */
export type ShapeField = { key: keyof FLSpielplanShape; label: string; minValue: number; maxValue?: number };

/**
 * The three the fixture list is a function of, in the panel's order. **One table for the fields and
 * the confirmation both**, so no readout can label a number differently from the field above it.
 * The bounds are the schema's, pinned by this file's test.
 */
export const SHAPE_FIELDS: readonly ShapeField[] = [
  { key: "number_of_groups", label: "Gruppen", minValue: 1, maxValue: 4 },
  { key: "teams_per_group", label: "Teams pro Gruppe", minValue: 2, maxValue: 16 },
  { key: "qualifiers_per_group", label: "Qualifikanten pro Gruppe", minValue: 1 },
];

/** The season's stored three: what a replace starts from, and what a first draw leaves untouched. */
export function readShape(rules: FLSaisonRules): FLSpielplanShape {
  return {
    number_of_groups: rules.number_of_groups,
    teams_per_group: rules.teams_per_group,
    qualifiers_per_group: rules.qualifiers_per_group,
  };
}

/** One row of the armed readout. `isChanged` is what makes a redraw a rules change as well as a draw. */
export type ShapeRow = { key: keyof FLSpielplanShape; label: string; value: string; isChanged: boolean };

/**
 * The armed confirmation's rows, one per rule. **A moved number is stated FROM and TO**: the draw
 * stores it, so a bare new value would hide that the season's shape moved.
 *
 * Prose rather than an arrow glyph, which a screen reader announces as nothing.
 */
export function describeShapeRows(stored: FLSpielplanShape, next: FLSpielplanShape): ShapeRow[] {
  return SHAPE_FIELDS.map(({ key, label }) => ({
    key,
    label,
    value: stored[key] === next[key] ? String(next[key]) : `von ${String(stored[key])} auf ${String(next[key])}`,
    isChanged: stored[key] !== next[key],
  }));
}
