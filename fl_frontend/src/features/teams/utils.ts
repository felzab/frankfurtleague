import { LIGA_EINWILLIGUNG } from "@/core/einwilligung";
import { SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { computeErgebnisFor, PHASE_RANK } from "@/features/spiele/utils";

import { EINWILLIGUNG_UMFANG, GRUPPEN_OPTIONS, KONTAKT_ROLLEN, WEBSITE_URL_SCHEME } from "./constants";

import type { FLSaison, FLSaisonPhase } from "@/features/saisons/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLGruppenTeam, FLKontaktperson, FLTeamMembership, FLTeamWithMemberships } from "./schemas";
import type { AdminKontakteRow, AdminKontaktSeat, GruppeOffer, KontaktpersonDraft, SaisonTeamKontakteDraft } from "./types";

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
 * `REQ-SQUAD-001` judges the row's `team_id` on the PATCH as well as on the reactivate, so a row
 * reassigned to a club this season holds comes back without its own club returning.
 */
const SQUAD_REPAIR =
  "Um einen solchen Eintrag zu reaktivieren, bearbeite den Spieler und weise den Eintrag im Bereich „Kader“ einem Team dieser Saison zu.";

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

  // The count is of LIVE rows, so zero says the squad stood empty and never that the club had no
  // players: one whose players were all ausgetragen first — the usual order — reports zero too.
  if (retiredSquadRows === 0) return `${spiele} Im Kader des ausscheidenden Teams stand kein Spieler.`;

  // Below the zero arm and never beside it: German counts nothing with a word, so „0 Kadereinträge“
  // must not be composed at all, not even to be discarded.
  const ausgetragen =
    retiredSquadRows === 1
      ? "Ein Kadereintrag des ausscheidenden Teams wurde ausgetragen."
      : `${String(retiredSquadRows)} Kadereinträge des ausscheidenden Teams wurden ausgetragen.`;

  return `${spiele} ${ausgetragen} ${SQUAD_REPAIR}`;
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

/**
 * A blank contact person, for the moment the editor's contact block is switched on. `erteilt_von` and
 * the date stay unanswered: who agreed, and when, is the one thing nobody may guess for the league.
 */
export const buildEmptyKontaktperson = (): KontaktpersonDraft => ({
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  geburtsdatum: "",
  // Stamped, never typed: the version names the wording this person is being asked to agree to, and
  // an admin transcribing a version number is a value nobody decided stored as though they had.
  einwilligung: { umfang: EINWILLIGUNG_UMFANG, erteilt_von: null, text_version: LIGA_EINWILLIGUNG.textVersion, datum: "" },
});

/**
 * The three blank seats, for the same moment. All three are PRESENT: a block filled in for the first
 * time records three whole people, an empty seat being what an erasure leaves and nothing else.
 */
export const buildEmptyKontakte = (): SaisonTeamKontakteDraft => ({
  trainer: buildEmptyKontaktperson(),
  ansprechperson: buildEmptyKontaktperson(),
  stellvertretung: buildEmptyKontaktperson(),
  trainer_ist_zugleich: null,
});

/**
 * Whether two seats really hold one person. The flag alone is an assertion the backend never checks,
 * so badging on it would state as fact that two different people are the same one.
 */
const isSamePerson = (a: FLKontaktperson | null, b: FLKontaktperson | null): boolean =>
  a !== null && b !== null && a.vorname === b.vorname && a.nachname === b.nachname && a.email === b.email && a.telefon === b.telefon;

/**
 * **One row per club**, never per seat: `kontakte` is embedded on `saison_teams`, so a seat has no id
 * and a per-seat row orders on a key nothing owns. A club with nothing on file contributes none: an
 * empty row answers "who can be reached" wrongly.
 */
export function buildKontaktRows(teams: readonly FLTeamWithMemberships[], saisonId: string | undefined): AdminKontakteRow[] {
  return teams.flatMap((team) => {
    const kontakte = team.memberships.find((membership) => membership.saison_id === saisonId)?.kontakte ?? null;
    if (kontakte === null) return [];

    const seats: AdminKontaktSeat[] = KONTAKT_ROLLEN.map(({ value, label }) => {
      const person = kontakte[value];

      return {
        rolle: value,
        label: label,
        // `geburtsdatum` is left behind, no cell here rendering it.
        person:
          person === null
            ? null
            : {
                vorname: person.vorname,
                nachname: person.nachname,
                email: person.email,
                telefon: person.telefon,
                einwilligung: person.einwilligung,
              },
        // The seat the block NAMES, so the badge follows the claim wherever it points rather than to
        // one hardcoded seat. Never the flag alone: two different people would then read as one.
        istTrainerZugleich: kontakte.trainer_ist_zugleich === value && isSamePerson(kontakte.trainer, person),
      };
    });

    return [
      {
        id: team.id,
        teamId: team.id,
        teamName: team.name,
        teamShorthand: team.shorthand,
        seats: seats,
        besetzt: seats.filter((seat) => seat.person !== null).length,
      },
    ];
  });
}

/**
 * What a website box reports upward: the whole URL, or `null` for a box nobody filled. **The one
 * place `""` becomes `null`** — the single spelling `OptionalExternalUrlSchema` states is kept by
 * coercing here, not by every reader testing for two.
 */
export function toWebsiteUrl(typed: string): string | null {
  // The scheme lives in the input group's prefix, so a pasted full URL is de-duplicated here.
  const rest = typed.replace(/^https?:\/\//i, "").trim();

  return rest === "" ? null : `${WEBSITE_URL_SCHEME}${rest}`;
}
