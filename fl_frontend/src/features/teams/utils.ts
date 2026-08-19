/**
 * TEAMS · derivations
 *
 * Pure derivation over a group's standing and over one team's own season — no I/O and no caching,
 * which is why it stays out of `queries.ts`.
 *
 * Invariants:
 * - The list is consumed in arrival order — the ranked order also seeds the bracket.
 * - The qualifying marker mirrors `_may_hold_a_platz`, or the page marks one team and the
 *   bracket seeds another.
 * - A season's progress never reports a team out of the group phase: that is evidenced by absence
 *   alone, which an undrawn bracket also looks like.
 */

import { SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
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
 * rows, and every junction row counts — a disqualified team never leaves its season, so
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
 * question and a different function.
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

/** How one round went for one team, as far as that team's own fixtures can say. */
export type SaisonPhaseOutcome =
  /** Its fixture was won on goals. */
  | "won"
  /** Its fixture was lost on goals — the run ends here. */
  | "out"
  /** Its round was played and a later one fields the team, so it got through whatever the goals said. */
  | "advanced"
  /** Its fixture carries no result yet. */
  | "pending"
  /** Its fixture finished level and no later round fields the team, so nobody here may name a winner. */
  | "level"
  /**
   * The round happened and nothing here can say how it went. **Only the group phase reaches this, and
   * it must never acquire an outcome word.** Passing a group is evidenced by a knockout fixture and
   * failing one only by the absence of that fixture — which an undrawn bracket looks exactly like, so
   * reading the absence as elimination would report a state that waiting fixes.
   */
  | "unknown";

export type SaisonPhaseVerlauf = {
  phase: FLSaisonPhase;
  outcome: SaisonPhaseOutcome;
};

/**
 * Each round this team has a fixture in, in the order a season plays them, and how that round went.
 *
 * Derived from the fixtures the team page already holds — no endpoint, no stored field and no second
 * request. `is_canceled` is deliberately not read, and neither state it can be in asks to
 * be: a cancelled fixture carrying a result is a forfeit and decided its round like any other, and
 * one carrying none has decided nothing — it is replayed or forfeited later, so its round is as open
 * as an unplayed one: `pending` for a knockout round, and the round's name with no outcome word for
 * the group phase. The cancellation itself is stated where a reader can act on it, in
 * `SpielDetailsModal`, rather than being folded into a round's outcome word.
 *
 * Invariants:
 * - Only a round the team has a fixture in produces an entry, so a season that plays no
 *   `achtelfinale` yields none rather than one saying the team failed to reach it.
 * - The group phase resolves to `advanced` or `unknown` and to nothing else. Absence of a knockout
 *   fixture is not elimination, and reading it as one would report a state that waiting fixes — an
 *   empty public page is honest where a wrong one is not.
 */
export const computeSaisonVerlauf = ({ spiele, teamId }: { spiele: readonly FLSpiel[]; teamId: string }): SaisonPhaseVerlauf[] => {
  const byPhase = new Map<FLSaisonPhase, FLSpiel[]>();

  for (const spiel of spiele) {
    // Not redundant with the fetch that supplies these: `GET /spiele?team_id=` matches both sides,
    // but nothing types that promise, and a fixture this team does not occupy decides nothing here.
    if (spiel.team1?.team_id !== teamId && spiel.team2?.team_id !== teamId) continue;

    const fixtures = byPhase.get(spiel.saison_phase);
    if (fixtures === undefined) byPhase.set(spiel.saison_phase, [spiel]);
    else fixtures.push(spiel);
  }

  const deepestRank = Math.max(-1, ...[...byPhase.keys()].map((phase) => PHASE_RANK[phase]));
  const verlauf: SaisonPhaseVerlauf[] = [];

  // The declared sequence rather than a written-out list of rounds, so a season configured for a
  // different set of knockout rounds needs no edit here.
  for (const phase of SAISON_PHASE_OPTIONS) {
    const fixtures = byPhase.get(phase);
    if (fixtures === undefined) continue;

    const advanced = PHASE_RANK[phase] < deepestRank;

    if (phase === "gruppenphase") {
      // Two readings and never a third: a knockout fixture beside a group that was actually played is
      // evidence the group was come through, and anything else is evidence of nothing at all.
      const played = fixtures.some((spiel) => computeErgebnisFor({ spiel, teamId }) !== "?");
      verlauf.push({ phase, outcome: advanced && played ? "advanced" : "unknown" });
      continue;
    }

    verlauf.push({ phase, outcome: knockoutOutcome(fixtures, teamId, advanced) });
  }

  return verlauf;
};

/**
 * How one knockout round went, read off the round's own result where that is a win and off the
 * bracket's own movement everywhere else.
 *
 * **Advancement is read off a later round's occupancy, never off a shoot-out.** A knockout that
 * finished level is a draw to every reader but the bracket, so this cannot take a winner
 * from `elfmeterschiessen` — but a team standing in the round after it went through, whatever the
 * goals said, and that is a fact about where the team is rather than about how the tie broke.
 *
 * **Occupancy outranks a loss for that same reason.** A manual pick that did not qualify is warned
 * and never refused, so an organiser can field a beaten team in the next round — the
 * withdrawal replacement — and `out` claims a run that ended, which a later fixture is the evidence
 * it did not. Reading the loss first would chip that round "ausgeschieden" beside a chip for the
 * round the team is standing in, which is one page contradicting itself.
 *
 * **It outranks nothing at all, though.** Occupancy says how a round was survived, never that it
 * happened: the same manual pick can seed a team out of a round whose fixture is still unplayed, and
 * "überstanden" beside a card showing no score claims a result the season does not have. A round with
 * no result stays `pending` however deep the team is standing.
 */
const knockoutOutcome = (fixtures: readonly FLSpiel[], teamId: string, advanced: boolean): SaisonPhaseOutcome => {
  const results = fixtures.map((spiel) => computeErgebnisFor({ spiel, teamId }));

  if (results.includes("W")) return "won";
  // Occupancy is evidence about a round that was played. A round with no result at all is still open,
  // whatever a later fixture says about where the team was placed.
  if (advanced && results.some((result) => result !== "?")) return "advanced";
  if (results.includes("L")) return "out";
  // "?" is a fixture carrying no result: a malformed scoreline is refused at the API boundary, and
  // a team on neither side was filtered out above.
  return results.every((result) => result === "?") ? "pending" : "level";
};
