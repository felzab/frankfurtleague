/**
 * TEAMS · derivations
 *
 * Pure derivation over a group's standing — no I/O and no caching, which is why it stays out of
 * `queries.ts` rather than being folded in (ADR-0004).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • The list is consumed in the order it arrives. `GET /teams` returns each group already ranked by
 *     the competition's tiebreak chain (ADR-0043), and the same ordering seeds the playoff bracket — so
 *     re-sorting here would be a second answer to who finished second.
 *   • Who may hold a qualifying place mirrors the backend's `_may_hold_a_platz` read on the table as it
 *     stands. The two must agree, or this page marks one team and the bracket seeds another.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/_decisions/0043-a-group-placing-is-ranked-by-one-chain-and-seeded-only-when-final.md
 */

import { GRUPPEN_OPTIONS } from "./constants";

import type { FLSaison } from "@/features/saisons/schemas";
import type { FLTeam, FLTeamMembership } from "./schemas";
import type { GruppeOffer } from "./types";

/**
 * One season's groups with their fill state, for the entry and move pickers.
 *
 * The backend's `offered_gruppen` + `find_entry_refusal` read on the memberships read: the season
 * runs the first `rules.number_of_groups` of the closed set, each taking `rules.teams_per_group`
 * rows, and every junction row counts — a disqualified team never leaves its season (ADR-0033), so
 * its place stays taken. The pickers disable what `POST /teams/{team_id}/saisons` would refuse
 * (REQ-ENTER-002/003), which stays the authoritative check.
 */
export const buildGruppeOffer = (saisonId: string, rules: FLSaison["rules"], memberships: readonly FLTeamMembership[][]): GruppeOffer[] => {
  const occupied = new Map<string, number>();
  for (const teamMemberships of memberships) {
    for (const membership of teamMemberships) {
      if (membership.saison_id === saisonId) occupied.set(membership.gruppe, (occupied.get(membership.gruppe) ?? 0) + 1);
    }
  }

  return GRUPPEN_OPTIONS.slice(0, rules.number_of_groups).map((gruppe) => ({
    gruppe,
    occupied: occupied.get(gruppe) ?? 0,
    capacity: rules.teams_per_group,
  }));
};

/**
 * Whether a row can hold a `Platz` at all, read on the table as it stands.
 *
 * The backend's `_may_hold_a_platz` with nothing left to play: a disqualified team keeps its row and
 * cannot advance out of it, and a team with no counting match holds no placing — its zeroed
 * `statistik` ranks above every negative goal difference, and the table prints `N/A` for it. Both
 * derivations below apply this one predicate, so the marker and the ordinal cannot disagree about
 * who is passed over.
 */
const mayHoldAPlatz = (team: FLTeam): boolean => team.disqualifikation === null && team.statistik.anzahl_gespielte_spiele > 0;

/**
 * The ids of the teams currently holding a qualifying place in one group.
 *
 * Two teams are passed over, and each for a reason that keeps this page and the bracket saying the same
 * thing:
 *
 * - **A disqualified team** keeps its row in the table and cannot advance out of it, so the place falls
 *   to the team below rather than being consumed.
 * - **A team with no counting match** holds no placing at all. The backend serves it a zeroed
 *   `statistik`, which ranks above every team with a negative goal difference, and the table already
 *   prints `N/A` instead of a position for that row — a row with no position cannot be shown holding one.
 *
 * "Currently" is the whole claim. This reads the table as it stands and says nothing about whether the
 * place is safe; the bracket seeds only once no remaining fixture can change it, which is a stricter
 * question and a different function (ADR-0043).
 */
export const computeQualifyingTeamIds = ({
  teams,
  qualifiersPerGroup,
}: {
  teams: readonly FLTeam[];
  qualifiersPerGroup: number;
}): ReadonlySet<string> => {
  const qualifying = new Set<string>();

  for (const team of teams) {
    if (qualifying.size === qualifiersPerGroup) break;
    if (!mayHoldAPlatz(team)) continue;

    qualifying.add(team.id);
  }

  return qualifying;
};

/**
 * Each qualifying-eligible team's position in one group, numbered as a `Platz` is.
 *
 * `Platz` counts only the teams that can hold a placing (`docs/glossary.md :: Platz`), so the count
 * walks past a disqualified row and a row with nothing played — a team with no entry here carries no
 * ordinal at all. A raw row index is the wrong number on exactly those tables: with a disqualified
 * team above the cut, the bracket's derived "2. der Gruppe A" names a team whose row index reads 3,
 * and the two surfaces would print different positions for one placing.
 */
export const computePlatzByTeamId = (teams: readonly FLTeam[]): ReadonlyMap<string, number> => {
  const platzByTeamId = new Map<string, number>();

  for (const team of teams) {
    if (!mayHoldAPlatz(team)) continue;

    platzByTeamId.set(team.id, platzByTeamId.size + 1);
  }

  return platzByTeamId;
};
