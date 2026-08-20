import { GRUPPEN_OPTIONS } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminTeamRow } from "./types";

/**
 * Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
 * key on the array's identity.
 */
export const TEAM_FACETS: readonly Facet<AdminTeamRow>[] = [
  {
    param: "zugehoerigkeit",
    label: "Saison",
    options: [
      { value: "aufgenommen", label: "In dieser Saison" },
      { value: "nicht_aufgenommen", label: "Nicht in dieser Saison" },
    ],
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
