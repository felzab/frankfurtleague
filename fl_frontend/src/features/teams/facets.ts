import { EINWILLIGUNG_HERKUNFT_OPTIONS, GRUPPEN_OPTIONS, KONTAKT_ROLLEN } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminKontaktRow, AdminTeamRow } from "./types";

/** Spelled once so the facet below and a link that has to outrank its default cannot name it differently. */
const SAISON_PARAM = "zugehoerigkeit";

/**
 * What a link INTO this list carries to reach a club whatever its season: the default answers for an
 * ABSENT parameter, an empty one turns the facet off
 * (`fl_frontend/src/shared/utils/facets.ts :: readFacetSelection`).
 */
export const TEAMS_ANY_SAISON_QUERY = `${SAISON_PARAM}=`;

/**
 * Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
 * key on the array's identity.
 */
export const TEAM_FACETS: readonly Facet<AdminTeamRow>[] = [
  {
    param: SAISON_PARAM,
    label: "Saison",
    options: [
      { value: "aufgenommen", label: "In dieser Saison" },
      { value: "nicht_aufgenommen", label: "Nicht in dieser Saison" },
    ],
    // The rows are every club in every season, so unnarrowed the list answers a question almost nobody arrives
    // with. The sidemenu's season is the one an admin came here about (owner's call, 2026-08-26).
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
export const KONTAKTE_FACETS: readonly Facet<AdminKontaktRow>[] = [
  {
    param: "rolle",
    label: "Rolle",
    options: KONTAKT_ROLLEN.map(({ value, label }) => ({ value, label })),
    read: (kontakt) => [kontakt.rolle],
  },
  {
    param: "einwilligung",
    label: "Einwilligung",
    options: EINWILLIGUNG_HERKUNFT_OPTIONS.map(({ value, label }) => ({ value, label })),
    // Who stood behind the agreement is the question an audit arrives with; when it was given is on
    // the row itself, where a range filter would answer worse than reading the column.
    read: (kontakt) => [kontakt.einwilligung.erteilt_von],
  },
];
