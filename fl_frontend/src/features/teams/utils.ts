/**
 * TEAMS · derivations
 *
 * Pure derivation over a group's standing and over one team's own season — no I/O and no caching,
 * which is why it stays out of `queries.ts` (ADR-0003).
 *
 * Invariants:
 * - The list is consumed in arrival order — the ranked order also seeds the bracket (ADR-0035).
 * - The qualifying marker mirrors `_may_hold_a_platz`, or the page marks one team and the
 *   bracket seeds another.
 * - A season's progress names no group placing: one is reported only once no remaining result can
 *   change it (ADR-0035), and the team page holds no standing to read it from.
 */

import { computeErgebnisFor, PHASE_RANK } from "@/features/spiele/utils";

import { GRUPPEN_OPTIONS } from "./constants";

import type { FLSaison, FLSaisonPhase } from "@/features/saisons/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLTeam, FLTeamMembership } from "./schemas";
import type { GruppeOffer } from "./types";

/**
 * One season's groups with their fill state, for the entry and move pickers.
 *
 * The backend's `offered_gruppen` + `find_entry_refusal` read on the memberships read: the season
 * runs the first `rules.number_of_groups` of the closed set, each taking `rules.teams_per_group`
 * rows, and every junction row counts — a disqualified team never leaves its season (ADR-0026), so
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
 * question and a different function (ADR-0035).
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

/** What one team's knockout run amounts to, once the fixtures it played are read in bracket order. */
export type SaisonVerlauf = {
  /** The furthest round a fixture actually fields the team in. */
  deepestPhase: FLSaisonPhase;
  /**
   * How that round ended for the team, or `null` while it is undecided. A knockout settled on
   * penalties is a draw here and therefore `null` too: the bracket is the only reader that takes a
   * winner from a shoot-out (ADR-0036), so this page cannot claim one.
   */
  outcome: "W" | "L" | null;
};

/**
 * How far a team got in this season's knockout rounds, or `null` where it played none at all.
 *
 * Derived from the fixtures the team page already holds — there is no endpoint, no stored field and
 * no second request behind it. `is_canceled` is deliberately not read: a cancelled fixture carrying
 * a result is a forfeit and decided its round like any other (ADR-0019).
 *
 * A group placing is not part of it, and that is the one omission worth stating: a placing is
 * reported only once no remaining result can change it (ADR-0035), so a milestone claiming one would
 * say nothing for most of a season.
 */
export const computeSaisonVerlauf = ({ spiele, teamId }: { spiele: readonly FLSpiel[]; teamId: string }): SaisonVerlauf | null => {
  let deepest: FLSpiel | null = null;

  for (const spiel of spiele) {
    if (spiel.saison_phase === "gruppenphase") continue;
    // Not redundant with the fetch that supplies these: `GET /spiele?team_id=` matches both sides,
    // but nothing types that promise, and a fixture this team does not occupy decides nothing here.
    if (spiel.team1?.team_id !== teamId && spiel.team2?.team_id !== teamId) continue;

    if (deepest === null || PHASE_RANK[spiel.saison_phase] > PHASE_RANK[deepest.saison_phase]) deepest = spiel;
  }

  if (deepest === null) return null;

  const ergebnisFor = computeErgebnisFor({ spiel: deepest, teamId });

  return {
    deepestPhase: deepest.saison_phase,
    outcome: ergebnisFor === "W" || ergebnisFor === "L" ? ergebnisFor : null,
  };
};
