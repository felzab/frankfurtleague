import { LIGA_KENNTNISNAHME } from "@/core/einwilligung";
import { SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { computeErgebnisFor, PHASE_RANK } from "@/features/spiele/utils";

import { EINWILLIGUNG_UMFANG, GRUPPEN_OPTIONS, KONTAKT_ROLLEN, TRIKOT_FARBE_OPTIONS, WEBSITE_URL_SCHEME } from "./constants";

import type { FLSaison, FLSaisonPhase } from "@/features/saisons/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpielErgebnisFor } from "@/features/spiele/utils";
import type { TrikotFarbeOption } from "./constants";
import type { FLGruppenTeam, FLKontaktperson, FLSaisonTeamKontakte, FLTeamMembership, FLTeamWithMemberships, FLTrikotFarbe } from "./schemas";
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
  ausgetrageneSquadRows,
}: {
  fannedOutToSpiele: number;
  ausgetrageneSquadRows: number;
}): string => {
  const spiele =
    fannedOutToSpiele === 0
      ? "Für das ausscheidende Team war noch kein Spiel angesetzt."
      : fannedOutToSpiele === 1
        ? "Ein angesetztes Spiel wurde übernommen."
        : `${String(fannedOutToSpiele)} angesetzte Spiele wurden übernommen.`;

  // The count is of LIVE rows, so zero says the squad stood empty and never that the club had no
  // players: one whose players were all ausgetragen first — the usual order — reports zero too.
  if (ausgetrageneSquadRows === 0) return `${spiele} Im Kader des ausscheidenden Teams stand kein Spieler.`;

  // Below the zero arm and never beside it: German counts nothing with a word, so „0 Kadereinträge“
  // must not be composed at all, not even to be discarded.
  const ausgetragen =
    ausgetrageneSquadRows === 1
      ? "Ein Kadereintrag des ausscheidenden Teams wurde ausgetragen."
      : `${String(ausgetrageneSquadRows)} Kadereinträge des ausscheidenden Teams wurden ausgetragen.`;

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
  /** Its fixture finished level and the shoot-out went its way. */
  | "wonInShootOut"
  /** Its fixture was lost on goals — the run ends here. */
  | "out"
  /** Its fixture finished level and the shoot-out went against it — the run ends here. */
  | "outInShootOut"
  /** Its round was played and a later one's winner or group placing fields the team, whatever the goals said. */
  | "advanced"
  /** Its fixture carries no result yet. */
  | "pending"
  /** Its fixture finished level with no shoot-out and no later round fields the team, so nobody here may name a winner. */
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

  // The deepest round the team is ADVANCED into: a side fed as `verlierer` — the third-place play-off —
  // stands in a later round too, and a side no reference feeds may be either, so neither proves the team
  // came through.
  const deepestAdvancedRank = Math.max(
    -1,
    ...spiele.filter((spiel) => isAdvancedInto(spiel, teamId)).map((spiel) => PHASE_RANK[spiel.saison_phase]),
  );
  const verlauf: SaisonPhaseVerlauf[] = [];

  // The declared sequence, so a season configured for different knockout rounds needs no edit here.
  for (const phase of SAISON_PHASE_OPTIONS) {
    const fixtures = byPhase.get(phase);
    if (fixtures === undefined) continue;

    const standsInALaterRound = PHASE_RANK[phase] < deepestAdvancedRank;

    if (phase === "gruppenphase") {
      // Two readings and never a third: a knockout side the team is advanced into, beside a group that
      // was actually played, is evidence the group was come through, and anything else is evidence of nothing.
      const played = fixtures.some((spiel) => computeErgebnisFor({ spiel, teamId }) !== "?");
      verlauf.push({ phase, outcome: standsInALaterRound && played ? "advanced" : "unknown" });
      continue;
    }

    verlauf.push({ phase, outcome: knockoutOutcome(fixtures, teamId, standsInALaterRound) });
  }

  return verlauf;
};

/** Whether the team holds a side of this fixture that a group placing or a match's winner feeds. */
const isAdvancedInto = (spiel: FLSpiel, teamId: string): boolean => {
  const quelle = spiel.team1?.team_id === teamId ? spiel.team1_quelle : spiel.team2?.team_id === teamId ? spiel.team2_quelle : null;

  return quelle !== null && (quelle.type === "gruppe" || quelle.ausgang === "sieger");
};

/**
 * How one knockout round went: off the round's own result where that is a win, off the bracket's
 * movement everywhere else.
 */
const knockoutOutcome = (fixtures: readonly FLSpiel[], teamId: string, standsInALaterRound: boolean): SaisonPhaseOutcome => {
  const entscheidungen = fixtures.map((spiel) => computeEntscheidungFor({ spiel, teamId }));
  const decided = (ergebnisFor: "S" | "N", imElfmeterschiessen: boolean): boolean =>
    entscheidungen.some((entscheidung) => entscheidung.ergebnisFor === ergebnisFor && entscheidung.imElfmeterschiessen === imElfmeterschiessen);

  if (decided("S", false)) return "won";
  if (decided("S", true)) return "wonInShootOut";
  // A round with no result at all is still open, however deep the team stands.
  if (standsInALaterRound && entscheidungen.some((entscheidung) => entscheidung.ergebnisFor !== "?")) return "advanced";
  if (decided("N", false)) return "out";
  if (decided("N", true)) return "outInShootOut";
  // "?" is a fixture carrying no result: a malformed scoreline is refused at the API boundary.
  return entscheidungen.every((entscheidung) => entscheidung.ergebnisFor === "?") ? "pending" : "level";
};

/** One team's result in one fixture, and whether the shoot-out rather than the goals decided it. */
type EntscheidungFor = { ergebnisFor: FLSpielErgebnisFor; imElfmeterschiessen: boolean };

/**
 * The bracket's reading of a level knockout (`docs/backend/spec.md :: I25`), for the team page's
 * rounds and fixtures alone. **Never a figure**: the table and the Saisonstatistik count the fixture as
 * the draw it finished as (`docs/backend/spec.md :: I25a`).
 */
export const computeEntscheidungFor = ({ spiel, teamId }: { spiel: FLSpiel; teamId: string }): EntscheidungFor => {
  const ergebnisFor = computeErgebnisFor({ spiel, teamId });
  const shootOut = spiel.elfmeterschiessen;

  // `fl_backend/app/api/spiele/services.py :: _outcome_of` reads no shoot-out on a group fixture, and
  // a level count names nobody, so neither may name a winner here.
  if (ergebnisFor !== "U" || spiel.saison_phase === "gruppenphase" || shootOut === null || shootOut.team1 === shootOut.team2) {
    return { ergebnisFor, imElfmeterschiessen: false };
  }

  // "U" already placed the team on one of the two sides, so a team that is not team1 is team2.
  const ownIsTeam1 = spiel.team1?.team_id === teamId;
  const own = ownIsTeam1 ? shootOut.team1 : shootOut.team2;
  const other = ownIsTeam1 ? shootOut.team2 : shootOut.team1;

  return { ergebnisFor: own > other ? "S" : "N", imElfmeterschiessen: true };
};

/**
 * A blank contact person, for the moment the editor's contact block is switched on. `erfasst_von` and
 * the date stay unanswered: who recorded it, and when, is the one thing nobody may guess for the league.
 */
export const buildEmptyKontaktperson = (): KontaktpersonDraft => ({
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  geburtsdatum: "",
  // Stamped, never typed: the version names the wording this person is being asked to agree to, and
  // an admin transcribing a version number is a value nobody decided stored as though they had.
  einwilligung: {
    umfang: EINWILLIGUNG_UMFANG,
    erfasst_von: null,
    text_version: LIGA_KENNTNISNAHME.textVersion,
    datum: "",
    // A confirmation link is the only writer of this stamp, so a seat an administrator opened here
    // has none and the blank is the truth rather than a value still to be filled in.
    bestaetigt_am: null,
  },
});

/**
 * The three blank seats, for the same moment. All three are PRESENT: a new block asks for three whole
 * people, and a seat left empty is one the admin switches off rather than the state it starts in.
 */
export const buildEmptyKontakte = (): SaisonTeamKontakteDraft => ({
  trainer: buildEmptyKontaktperson(),
  ansprechperson: buildEmptyKontaktperson(),
  stellvertretung: buildEmptyKontaktperson(),
  trainer_ist_zugleich: null,
});

/**
 * Two shapes store nobody on file — `null` on a row nobody filled in, three empty seats on one switched
 * off or erased — and both are read alike. The claim is not read: over nobody it names nobody.
 */
export function holdsNobody(kontakte: FLSaisonTeamKontakte | SaisonTeamKontakteDraft | null): boolean {
  return kontakte === null || KONTAKT_ROLLEN.every(({ value }) => kontakte[value] === null);
}

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
    if (kontakte === null || holdsNobody(kontakte)) return [];

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
 * The season `/dashboard/teams/[team_id]` shows a club in, or `null` where that page would 404. A
 * planned season is withheld from the public tier, and a request naming one lands on the running
 * season (`fl_frontend/src/features/saisons/resolvers.ts :: resolveSaisonId`).
 */
export function publicTeamSaisonId(
  saisons: readonly Pick<FLSaison, "id" | "status">[],
  selectedSaisonId: string | undefined,
  memberships: readonly Pick<FLTeamMembership, "saison_id">[],
): string | null {
  const selected = saisons.find((saison) => saison.id === selectedSaisonId);
  const shown = selected?.status === "future" ? saisons.find((saison) => saison.status === "active") : selected;

  // The strict junction join: a club with no row in the shown season is no team there at all
  // (`docs/glossary.md :: Team`).
  return shown !== undefined && memberships.some((membership) => membership.saison_id === shown.id) ? shown.id : null;
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

/**
 * Which colours a picker offers once the season's ASSIGNED ones are left out. Its own function
 * because the empty offer is a boundary a test can exercise without rendering.
 */
export function offeredTrikotFarben({
  vergeben,
  value,
}: {
  vergeben: readonly FLTrikotFarbe[];
  /** The colour the field already holds, which survives the exclusion so a saved row still reads. */
  value: FLTrikotFarbe | null;
}): readonly TrikotFarbeOption[] {
  // The exclusion and nothing else, so the picker never offers a colour the season has given away.
  // A season holding all sixteen therefore offers nothing, which the required wish has no answer for.
  return TRIKOT_FARBE_OPTIONS.filter((option) => option.value === value || !vergeben.includes(option.value));
}
