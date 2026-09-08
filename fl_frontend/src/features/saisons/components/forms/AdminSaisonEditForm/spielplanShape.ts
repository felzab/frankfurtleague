import { MAX_QUALIFIERS } from "@/features/saisons/schemas";
import { GRUPPEN_OPTIONS } from "@/features/teams/constants";

import type { FLSaisonRules, FLSpielplanShape } from "@/features/saisons/schemas";

/** One of the three, as the panel both offers and reads it back. */
export type ShapeField = { key: keyof FLSpielplanShape; label: string; minValue: number; maxValue: number };

/**
 * The three the fixture list is a function of, in the panel's order. **One table for the fields and
 * the confirmation both**, so no readout can label a number differently from the field above it.
 * The bounds are the schema's, pinned by this file's test.
 */
export const SHAPE_FIELDS: readonly ShapeField[] = [
  // A season runs a prefix of the closed set, so the set's own size is the ceiling: a literal here
  // would display a wider season's stored count snapped down to it.
  { key: "number_of_groups", label: "Gruppen", minValue: 1, maxValue: GRUPPEN_OPTIONS.length },
  { key: "teams_per_group", label: "Teams pro Gruppe", minValue: 2, maxValue: 16 },
  { key: "qualifiers_per_group", label: "Qualifikanten pro Gruppe", minValue: 1, maxValue: MAX_QUALIFIERS },
];

/**
 * A field left at its schema bound alone walks upward into a refusal an admin meets only after the
 * press, which is what `REQ-RULES-001` and `REQ-RULES-007` between them make of a qualifier count.
 */
export function shapeCeiling(field: ShapeField, shape: FLSpielplanShape): number {
  if (field.key !== "qualifiers_per_group") return field.maxValue;

  // `REQ-RULES-001` caps the PRODUCT at `MAX_QUALIFIERS` and `REQ-RULES-007` the count at the group's
  // own size; the tighter of the two bounds the offer.
  const bounded = Math.max(1, Math.min(field.maxValue, Math.floor(MAX_QUALIFIERS / shape.number_of_groups), shape.teams_per_group));

  // Rounded DOWN to a power of two, by the bit rather than `Math.log2`, whose float can land a
  // boundary either way. The product halves to a final, so both factors are powers of two and any
  // other bound is refused.
  const highest = 1 << (31 - Math.clz32(bounded));

  // Never below the value the draft holds: react-stately snaps a controlled `value` into the range
  // before rendering and calls no handler, so a lower ceiling would show a figure the payload does
  // not carry.
  return Math.max(highest, shape.qualifiers_per_group);
}

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
