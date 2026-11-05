import { KADER_ABSCHNITT } from "@/features/spieler/constants";

import { EINWILLIGUNG_UMFANG, GRUPPEN_OPTIONS, KONTAKT_ROLLEN, TRIKOT_FARBE_OPTIONS, WEBSITE_URL_SCHEME } from "./constants";

import type {
  FLKontaktperson,
  FLSaison,
  FLSaisonRules,
  FLSaisonTeamKontakte,
  FLTeamMembership,
  FLTeamWithMemberships,
  FLTrikotFarbe,
} from "@/core/generated/client/types";
import type { TrikotFarbeOption } from "./constants";
import type { AdminKontakteRow, AdminKontaktSeat, GruppeOffer, KontaktpersonDraft, SaisonTeamKontakteDraft } from "./types";

/**
 * Every junction row counts — a disqualified team never leaves its season. The pickers disable what
 * `POST /teams/{team_id}/saisons` would refuse (`entry_gruppe_not_offered/003`), which stays authoritative.
 */
export const buildGruppeOffer = (saisonId: string, rules: FLSaisonRules, memberships: readonly FLTeamMembership[][]): GruppeOffer[] => {
  const occupied = new Map<string, number>();
  for (const teamMemberships of memberships) {
    for (const membership of teamMemberships) {
      if (membership.saison_id === saisonId) occupied.set(membership.gruppe, (occupied.get(membership.gruppe) ?? 0) + 1);
    }
  }

  return GRUPPEN_OPTIONS.slice(0, rules.number_of_gruppen).map((gruppe) => ({
    gruppe,
    occupied: occupied.get(gruppe) ?? 0,
    capacity: rules.teams_per_gruppe,
  }));
};

/**
 * `kader_team_not_in_saison` judges the row's `team_id` on the PATCH as well as on the reactivate, so a row
 * reassigned to a club this season holds comes back without its own club returning.
 */
const SQUAD_REPAIR = `Um einen solchen Eintrag zu reaktivieren, bearbeite den Spieler und weise den Eintrag im Bereich „${KADER_ABSCHNITT}“ einem Team dieser Saison zu.`;

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
 * A blank contact person, for the moment the editor's contact block is switched on. The stamp and the
 * date stay unanswered: whether the person answered, and when, is the one thing nobody may guess for the league.
 */
export const buildEmptyKontaktperson = (): KontaktpersonDraft => ({
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  geburtsdatum: "",
  einwilligung: {
    scope: EINWILLIGUNG_UMFANG,
    date: "",
    // A confirmation link is the only writer of this stamp, so a seat an administrator opened here
    // has none and the blank is the truth rather than a value still to be filled in.
    confirmed_at: null,
    media: false,
    // The save that seats the person stamps who seated them; no payload carries it, so the form never guesses.
    entered_by: null,
    evidence: { scope: null, media: null },
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
  trainer_is_also: null,
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
        istTrainerZugleich: kontakte.trainer_is_also === value && isSamePerson(kontakte.trainer, person),
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
 * The season whose club page (`fl_frontend/src/core/routes.ts :: ROUTES.team`) shows a club, or `null`
 * where that page would 404. A planned season is withheld from the public tier, so a club picked in one
 * is shown in the running season.
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
 * `retire_blocked` mirrored, so neither the list nor the editor offers a retirement the write path refuses: no running
 * or planned season may hold the club.
 */
export function isRetireable(
  saisons: readonly Pick<FLSaison, "id" | "status">[],
  memberships: readonly Pick<FLTeamMembership, "saison_id">[],
): boolean {
  const statusBySaisonId = new Map(saisons.map((saison) => [saison.id, saison.status]));

  return !memberships.some((membership) => {
    const status = statusBySaisonId.get(membership.saison_id);
    return status === "active" || status === "future";
  });
}

/**
 * What a website box reports upward: the whole URL, or `null` for a box nobody filled. **The one
 * place `""` becomes `null`** — the single spelling of absence the API publishes is kept by
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
  taken,
  value,
}: {
  taken: readonly FLTrikotFarbe[];
  /** The colour the field already holds, which survives the exclusion so a saved row still reads. */
  value: FLTrikotFarbe | null;
}): readonly TrikotFarbeOption[] {
  // The exclusion and nothing else, so the picker never offers a colour the season has given away.
  // A season holding every colour therefore offers nothing, which the required wish has no answer for.
  return TRIKOT_FARBE_OPTIONS.filter((option) => option.value === value || !taken.includes(option.value));
}
