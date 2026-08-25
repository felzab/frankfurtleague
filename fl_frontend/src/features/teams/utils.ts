import { SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { computeErgebnisFor, PHASE_RANK } from "@/features/spiele/utils";

import { GRUPPEN_OPTIONS } from "./constants";

import type { FLSaison, FLSaisonPhase } from "@/features/saisons/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLGruppenTeam, FLTeamMembership } from "./schemas";
import type { GruppeOffer } from "./types";

/**
 * Every junction row counts — a disqualified team never leaves its season. The pickers disable what
 * `POST /teams/{team_id}/saisons` would refuse (`REQ-ENTER-002/003`), which stays authoritative.
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
 * The one route back for a squad row this write took out: its own club has to hold a place in the
 * season again, and `REQ-ENTER-001` admits a club only to a `future` one.
 */
const SQUAD_STAYS_OUT =
  "Reaktivieren lässt sich ein solcher Eintrag erst, wenn das ausscheidende Team wieder in dieser Saison steht — " +
  "und aufnehmen lässt sich ein Team nur in eine geplante Saison.";

/**
 * What one replacement moved, for the report that follows it. The squad half says AUSTRAGEN: this
 * write stamps `saison_spieler` rows, and STILLLEGEN is what happens to the person across the league.
 */
export const describeReplacementUmfang = ({
  fannedOutToSpiele,
  retiredSquadRows,
}: {
  fannedOutToSpiele: number;
  retiredSquadRows: number;
}): string => {
  const spiele =
    fannedOutToSpiele === 0
      ? "Für das ausscheidende Team war noch kein Spiel angesetzt."
      : fannedOutToSpiele === 1
        ? "Ein angesetztes Spiel wurde übernommen."
        : `${String(fannedOutToSpiele)} angesetzte Spiele wurden übernommen.`;

  const ausgetragen =
    retiredSquadRows === 1
      ? "Ein Kadereintrag des ausscheidenden Teams wurde ausgetragen."
      : `${String(retiredSquadRows)} Kadereinträge des ausscheidenden Teams wurden ausgetragen.`;

  // The count is of LIVE rows, so zero says the squad stood empty and never that the club had no
  // players: one whose players were all ausgetragen first — the usual order — reports zero too.
  const kader = retiredSquadRows === 0 ? "Im Kader des ausscheidenden Teams stand kein Spieler." : `${ausgetragen} ${SQUAD_STAYS_OUT}`;

  return `${spiele} ${kader}`;
};

/**
 * `fl_backend/app/api/teams/services.py :: _may_hold_a_platz`, over the row that endpoint serves.
 * One rule, so the table and the bracket cannot name different qualifiers
 * (`docs/backend/spec.md :: I24b`).
 */
const mayHoldAPlatz = (team: FLGruppenTeam): boolean =>
  team.austritt_type === null && team.statistik.anzahl_gespielte_spiele + team.anzahl_ausstehende_spiele > 0;

/**
 * "Currently" is the whole claim: this reads the table as it stands and says nothing about whether
 * the place is safe. The bracket seeds only once no remaining fixture can change it.
 */
export const computeQualifyingTeamIds = ({
  teams,
  qualifiersPerGroup,
}: {
  teams: readonly FLGruppenTeam[];
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
 * Numbered as a `Platz` is (`docs/glossary.md :: Platz`), walking past a row that can hold none.
 * **A club absent from this map is the table's `N/A`**, so nothing may restate the rule at a cell.
 */
export const computePlatzByTeamId = (teams: readonly FLGruppenTeam[]): ReadonlyMap<string, number> => {
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
   * **Only the group phase reaches this, and it must never acquire an outcome word.** Failing a group
   * is evidenced only by the absence of a knockout fixture — which an undrawn bracket looks like too.
   */
  | "unknown";

export type SaisonPhaseVerlauf = {
  phase: FLSaisonPhase;
  outcome: SaisonPhaseOutcome;
};

/**
 * Each round this team has a fixture in, in playing order. Only a round with a fixture gets an
 * entry, so a season that plays no `achtelfinale` yields none rather than a failure to reach it.
 */
export const computeSaisonVerlauf = ({ spiele, teamId }: { spiele: readonly FLSpiel[]; teamId: string }): SaisonPhaseVerlauf[] => {
  const byPhase = new Map<FLSaisonPhase, FLSpiel[]>();

  // `sonderereignis` is deliberately not read: a round is come through exactly when a fixture carries
  // an `ergebnis`, and the two members awarding nothing — `ausgefallen`, `annulliert` — carry none by
  // construction.
  for (const spiel of spiele) {
    // Not redundant with the fetch: `GET /spiele?team_id=` matches both sides, but nothing types
    // that promise.
    if (spiel.team1?.team_id !== teamId && spiel.team2?.team_id !== teamId) continue;

    const fixtures = byPhase.get(spiel.saison_phase);
    if (fixtures === undefined) byPhase.set(spiel.saison_phase, [spiel]);
    else fixtures.push(spiel);
  }

  const deepestRank = Math.max(-1, ...[...byPhase.keys()].map((phase) => PHASE_RANK[phase]));
  const verlauf: SaisonPhaseVerlauf[] = [];

  // The declared sequence, so a season configured for different knockout rounds needs no edit here.
  for (const phase of SAISON_PHASE_OPTIONS) {
    const fixtures = byPhase.get(phase);
    if (fixtures === undefined) continue;

    const standsInALaterRound = PHASE_RANK[phase] < deepestRank;

    if (phase === "gruppenphase") {
      // Two readings and never a third: a knockout fixture beside a group that was actually played is
      // evidence the group was come through, and anything else is evidence of nothing at all.
      const played = fixtures.some((spiel) => computeErgebnisFor({ spiel, teamId }) !== "?");
      verlauf.push({ phase, outcome: standsInALaterRound && played ? "advanced" : "unknown" });
      continue;
    }

    verlauf.push({ phase, outcome: knockoutOutcome(fixtures, teamId, standsInALaterRound) });
  }

  return verlauf;
};

/**
 * How one knockout round went: off the round's own result where that is a win, off the bracket's
 * movement everywhere else.
 */
const knockoutOutcome = (fixtures: readonly FLSpiel[], teamId: string, standsInALaterRound: boolean): SaisonPhaseOutcome => {
  const results = fixtures.map((spiel) => computeErgebnisFor({ spiel, teamId }));

  if (results.includes("W")) return "won";
  // Occupancy, never a shoot-out: a level knockout is a draw to every reader but the bracket. A round
  // with no result at all is still open, however deep the team stands.
  if (standsInALaterRound && results.some((result) => result !== "?")) return "advanced";
  // Occupancy outranks a loss: a manual pick that did not qualify is warned and never refused, so a
  // beaten team can be fielded in the next round, and a later fixture disproves `out`.
  if (results.includes("L")) return "out";
  // "?" is a fixture carrying no result: a malformed scoreline is refused at the API boundary.
  return results.every((result) => result === "?") ? "pending" : "level";
};
