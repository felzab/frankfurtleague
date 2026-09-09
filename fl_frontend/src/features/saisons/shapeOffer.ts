import { MAX_QUALIFIERS } from "@/features/saisons/schemas";
import { GRUPPEN_OPTIONS } from "@/features/teams/constants";

import type { SaisonGruppenOccupancy } from "@/features/saisons/types";
import type { FLGruppenNames } from "@/features/teams/schemas";
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
export type ShapeRefusal = "noBracket" | "bracketTooLarge" | "overQualifies" | "groupsInUse" | "gruppenOffSize";

/**
 * A closed row's note, in `RefusableSelect`'s register — a state phrase, no sentence. One table for
 * every panel: all three word these refusals identically.
 */
export const SHAPE_REFUSAL_NOTE: Record<ShapeRefusal, string> = {
  noBracket: "keine KO-Runde",
  bracketTooLarge: "zu viele für die KO-Runde",
  overQualifies: "mehr als die Gruppe fasst",
  // Opening on a verb: a row's name IS a count here, and a note opening on a noun would read as
  // one more part of the number.
  groupsInUse: "lässt Teams ohne Gruppe",
  gruppenOffSize: "passt nicht zu den Teams",
};

/**
 * A count's two halves of the closed name set, mirroring
 * `fl_backend/app/api/teams/services.py :: offered_gruppen`: a season runs a PREFIX of it, so every
 * name past the count is one the season does not offer.
 */
function partitionGruppen(groups: number): { offered: readonly FLGruppenNames[]; unoffered: readonly FLGruppenNames[] } {
  return { offered: GRUPPEN_OPTIONS.slice(0, groups), unoffered: GRUPPEN_OPTIONS.slice(groups) };
}

/** Zero for a season holding no club, as `find_rules_refusal`'s `max(…, default=0)` answers it. */
function fullestGruppe(occupancy: SaisonGruppenOccupancy): number {
  return Math.max(0, ...Object.values(occupancy).map((held) => held ?? 0));
}

/**
 * `REQ-RULES-002`, mirroring `find_rules_refusal`'s `stranded`: a count that stops running a group
 * the season's clubs stand in.
 */
function groupsInUseRefusal(groups: number, occupancy: SaisonGruppenOccupancy): ShapeRefusal | null {
  return partitionGruppen(groups).unoffered.some((gruppe) => (occupancy[gruppe] ?? 0) > 0) ? "groupsInUse" : null;
}

/**
 * `REQ-SPIELPLAN-004` over one shape, in the order `find_spielplan_refusal` composes its message: a
 * group off its size ahead of a club outside the offered groups, which is `REQ-RULES-002`'s own fact
 * and takes its note.
 */
function drawGruppenRefusal({
  groups,
  teams,
  occupancy,
}: {
  groups: number;
  teams: number;
  occupancy: SaisonGruppenOccupancy;
}): ShapeRefusal | null {
  // EXACTLY, and over the offered groups rather than the occupied ones: a group holding nobody owes
  // the same round robin as a full one, so the draw is refused for it too.
  if (partitionGruppen(groups).offered.some((gruppe) => (occupancy[gruppe] ?? 0) !== teams)) return "gruppenOffSize";

  return groupsInUseRefusal(groups, occupancy);
}

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

/**
 * The RULES patch's offer: `REQ-RULES-001` ahead of `REQ-RULES-002`, as `find_rules_refusal` judges
 * them. The team count reaches no row here — it bounds the qualifiers and never the groups.
 */
export function groupCountOptions({
  groups,
  qualifiers,
  occupancy,
}: {
  groups: number;
  qualifiers: number;
  occupancy: SaisonGruppenOccupancy;
}): RefusableOption[] {
  return countOptions(GROUP_COUNT_UNIVERSE, groups, (count) => bracketRefusal(count, qualifiers) ?? groupsInUseRefusal(count, occupancy));
}

/**
 * The DRAW's offer for the same count, occupancy FIRST: that endpoint runs `find_spielplan_refusal`
 * ahead of `find_rules_refusal`, and passes the latter `stored=None`, which drops `REQ-RULES-002` and
 * `REQ-RULES-003` from the draw altogether.
 */
export function drawGroupCountOptions({
  groups,
  qualifiers,
  teams,
  occupancy,
}: {
  groups: number;
  qualifiers: number;
  teams: number;
  occupancy: SaisonGruppenOccupancy;
}): RefusableOption[] {
  return countOptions(
    GROUP_COUNT_UNIVERSE,
    groups,
    (count) => drawGruppenRefusal({ groups: count, teams, occupancy }) ?? bracketRefusal(count, qualifiers),
  );
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

/**
 * `REQ-RULES-007` from below, and two at the least, or the group generates no fixture at all. The
 * fullest group joins them for `REQ-RULES-003`, and the draw refuses a count under it too
 * (`drawGruppenRefusal`).
 */
export function teamsPerGroupFloor({
  qualifiers,
  held,
  occupancy,
}: {
  qualifiers: number;
  held: number | null;
  occupancy: SaisonGruppenOccupancy;
}): number {
  const floor = Math.max(MIN_TEAMS_PER_GROUP, qualifiers, fullestGruppe(occupancy));

  // Never above the value the draft holds: react-stately snaps a controlled value into the range
  // before rendering and calls no handler, so the box would show what the payload does not carry.
  return held === null ? floor : Math.min(floor, held);
}
