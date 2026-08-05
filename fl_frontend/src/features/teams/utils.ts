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

import type { FLTeam } from "./schemas";

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
    if (team.is_disqualified || team.statistik.anzahl_gespielte_spiele === 0) continue;

    qualifying.add(team.id);
  }

  return qualifying;
};
