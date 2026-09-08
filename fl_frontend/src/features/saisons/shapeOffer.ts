import { MAX_QUALIFIERS } from "@/features/saisons/schemas";
import { GRUPPEN_OPTIONS } from "@/features/teams/constants";

import type { RefusableOption } from "@/shared/components/ui/refusableOption";

/**
 * Mirrors `fl_backend/app/api/teams/schemas.py :: MAX_NUMBER_OF_GROUPS`: a season runs a prefix of
 * the closed name set, so the set's own size is what caps it.
 */
export const MAX_GROUPS = GRUPPEN_OPTIONS.length;

// Mirrored from `fl_frontend/src/features/saisons/schemas.ts :: FLSaisonRulesSchema`, which says why
// each one is where it is: a field offering a number the submit refuses is one that wasted the trip.
export const MIN_TEAMS_PER_GROUP = 2;
export const MAX_TEAMS_PER_GROUP = 16;

/** By doubling rather than through `Math.log2`, whose float can land a boundary either way. */
function powersOfTwoUpTo(ceiling: number): number[] {
  const counts: number[] = [];
  for (let count = 1; count <= ceiling; count *= 2) counts.push(count);

  return counts;
}

/**
 * `REQ-RULES-001` asks the PRODUCT to be a power of two, and a product of two positives is one
 * exactly when both factors are: membership here is that rule read once rather than a second copy of
 * the schema's refinement.
 */
export const SHAPE_COUNT_UNIVERSE: readonly number[] = powersOfTwoUpTo(MAX_QUALIFIERS);

/** Narrower than the universe only where the closed name set is smaller than the bracket. */
export const GROUP_COUNT_UNIVERSE: readonly number[] = SHAPE_COUNT_UNIVERSE.filter((count) => count <= MAX_GROUPS);

/** Two kinds for `REQ-RULES-001` and not one: a bracket too large comes down, one too small goes up. */
export type ShapeRefusal = "noBracket" | "bracketTooLarge" | "overQualifies";

/**
 * A closed row's note, in `RefusableSelect`'s register — a state phrase, no sentence. One table for
 * every panel: all three word these refusals identically.
 */
export const SHAPE_REFUSAL_NOTE: Record<ShapeRefusal, string> = {
  noBracket: "keine KO-Runde",
  bracketTooLarge: "zu viele für die KO-Runde",
  overQualifies: "mehr als die Gruppe fasst",
};

/** `REQ-RULES-001` over a pair, size bound first: too large and no bracket send a reader opposite ways. */
function bracketRefusal(groups: number, qualifiers: number): ShapeRefusal | null {
  const bracket = groups * qualifiers;

  if (bracket > MAX_QUALIFIERS) return "bracketTooLarge";
  // A one-club bracket is no knockout round at all: `knockout_phases_for` is empty below two.
  if (bracket < 2) return "noBracket";

  // A count off the universe makes the product a non-power-of-two whatever stands beside it, which
  // is the state a season stored before these rules can still be in.
  return SHAPE_COUNT_UNIVERSE.includes(groups) && SHAPE_COUNT_UNIVERSE.includes(qualifiers) ? null : "noBracket";
}

/**
 * In `find_rules_refusal`'s own order — `REQ-RULES-007` ahead of `REQ-RULES-001` — so a closed row's
 * note is the refusal the endpoint would have named. A `null` team count is an emptied box, which
 * has answered nothing and constrains nothing.
 */
function qualifierCountRefusal({ count, groups, teams }: { count: number; groups: number; teams: number | null }): ShapeRefusal | null {
  if (teams !== null && count > teams) return "overQualifies";

  return bracketRefusal(groups, count);
}

/** A value the season HOLDS is always a row (`docs/frontend/spec.md :: 1.19`): the trigger and the list have to agree. */
function countOptions(universe: readonly number[], held: number, refusalOf: (count: number) => ShapeRefusal | null): RefusableOption[] {
  const counts = universe.includes(held) ? universe : [...universe, held].sort((first, second) => first - second);

  return counts.map((count) => {
    const refusal = refusalOf(count);

    return { id: String(count), name: String(count), meta: null, refusal: refusal === null ? null : SHAPE_REFUSAL_NOTE[refusal] };
  });
}

/** Only `REQ-RULES-001` reaches a group count: the team count bounds the qualifiers and never the groups. */
export function groupCountOptions({ groups, qualifiers }: { groups: number; qualifiers: number }): RefusableOption[] {
  return countOptions(GROUP_COUNT_UNIVERSE, groups, (count) => bracketRefusal(count, qualifiers));
}

/** The `qualifiers_per_group` offer as the season stands. */
export function qualifierCountOptions({
  groups,
  qualifiers,
  teams,
}: {
  groups: number;
  qualifiers: number;
  teams: number | null;
}): RefusableOption[] {
  return countOptions(SHAPE_COUNT_UNIVERSE, qualifiers, (count) => qualifierCountRefusal({ count, groups, teams }));
}

/** `REQ-RULES-007` from below, and two at the least, or the group generates no fixture at all. */
export function teamsPerGroupFloor({ qualifiers, held }: { qualifiers: number; held: number | null }): number {
  const floor = Math.max(MIN_TEAMS_PER_GROUP, qualifiers);

  // Never above the value the draft holds: react-stately snaps a controlled value into the range
  // before rendering and calls no handler, so the box would show what the payload does not carry.
  return held === null ? floor : Math.min(floor, held);
}
