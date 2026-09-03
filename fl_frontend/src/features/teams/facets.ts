import { EINWILLIGUNG_HERKUNFT_OPTIONS, GRUPPEN_OPTIONS, KONTAKT_ROLLEN } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminKontakteRow, AdminTeamRow } from "./types";

/**
 * Spelled once so the facet below and a link that has to outrank its default cannot name it
 * differently. NOT the season itself, whose name `fl_frontend/src/shared/utils/saisonHref.ts ::
 * SAISON_PARAM` owns.
 */
const ZUGEHOERIGKEIT_PARAM = "zugehoerigkeit";

/**
 * What a link INTO this list carries to reach a club whatever its season: the default answers for an
 * ABSENT parameter, an empty one turns the facet off
 * (`fl_frontend/src/shared/utils/facets.ts :: readFacetSelection`).
 */
export const TEAMS_ANY_SAISON_QUERY = `${ZUGEHOERIGKEIT_PARAM}=`;

/**
 * Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
 * key on the array's identity.
 */
export const TEAM_FACETS: readonly Facet<AdminTeamRow>[] = [
  {
    param: ZUGEHOERIGKEIT_PARAM,
    label: "Saison",
    options: [
      { value: "aufgenommen", label: "In dieser Saison" },
      { value: "nicht_aufgenommen", label: "Nicht in dieser Saison" },
    ],
    // The rows are every club in every season, so unnarrowed the list answers a question almost nobody arrives
    // with. The sidemenu's season is the one an admin came here about.
    defaultValues: ["aufgenommen"],
    // Asks about the season the sidemenu holds, through the page's own `selected`, rather than
    // about a season of its own.
    read: (team) => [team.selected === null ? "nicht_aufgenommen" : "aufgenommen"],
  },
  {
    param: "gruppe",
    label: "Gruppe",
    options: GRUPPEN_OPTIONS.map((gruppe) => ({ value: gruppe, label: `Gruppe ${gruppe}` })),
    // A club with no junction row holds no group, so picking any group filters it out — the honest
    // answer, since it is in none.
    read: (team) => (team.selected === null ? [] : [team.selected.gruppe]),
  },
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "ausgeschieden", label: "Ausgeschieden" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    // Not mutually exclusive: a retired club can also have left a season it played, and `aktiv`
    // is the absence of both. One option for both routes out: the row records which it was, and a
    // reader asking after this club is asking whether it still competes.
    read: (team) => {
      const held: string[] = [];
      if (team.inactive_since !== null) held.push("stillgelegt");
      if (team.selected?.austritt != null) held.push("ausgeschieden");
      if (held.length === 0) held.push("aktiv");
      return held;
    },
  },
];

/**
 * Module scope, for `TEAM_FACETS`'s reason. No season dimension: the page reads one season already,
 * so a facet here could only ask the question the sidemenu selector has answered.
 */
/** What a club's three seats add up to, which is the question the list is worked down by. */
export const KONTAKTE_BESETZUNG_OPTIONS = [
  { value: "vollstaendig", label: "Alle drei besetzt" },
  { value: "teilweise", label: "Teilweise besetzt" },
  { value: "leer", label: "Keine Kontakte" },
] as const;

/** One row answers exactly one of the three, so the facet partitions the list rather than filtering it. */
export function kontakteBesetzung(besetzt: number): (typeof KONTAKTE_BESETZUNG_OPTIONS)[number]["value"] {
  if (besetzt === 0) return "leer";

  return besetzt === KONTAKT_ROLLEN.length ? "vollstaendig" : "teilweise";
}

export const KONTAKTE_FACETS: readonly Facet<AdminKontakteRow>[] = [
  {
    param: "besetzung",
    label: "Besetzung",
    options: KONTAKTE_BESETZUNG_OPTIONS.map(({ value, label }) => ({ value, label })),
    read: (row) => [kontakteBesetzung(row.besetzt)],
  },
  {
    param: "einwilligung",
    label: "Einwilligung",
    options: EINWILLIGUNG_HERKUNFT_OPTIONS.map(({ value, label }) => ({ value, label })),
    /* Across all three seats, because the row is now the club: a club answers every herkunft one of
       its people gave. Seats holding nobody answer with none, so no herkunft claims them. */
    read: (row) => [...new Set(row.seats.flatMap((seat) => (seat.person === null ? [] : [seat.person.einwilligung.erteilt_von])))],
  },
];

/**
 * The facets with a club filter in front, so a link from another list can preselect one club — the
 * shape `fl_frontend/src/features/spieler/facets.ts :: buildSpielerFacets` uses for the same move.
 */
export function buildKontakteFacets(teams: readonly { teamId: string; name: string }[]): readonly Facet<AdminKontakteRow>[] {
  if (teams.length === 0) return KONTAKTE_FACETS;

  const teamFacet: Facet<AdminKontakteRow> = {
    param: "team",
    label: "Team",
    options: teams.map((team) => ({ value: team.teamId, label: team.name })),
    read: (row) => [row.teamId],
  };

  return [teamFacet, ...KONTAKTE_FACETS];
}
