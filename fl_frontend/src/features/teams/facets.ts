/**
 * TEAMS · what the admin club list can be narrowed by
 *
 * Its own module rather than an export from `constants.ts`, for the reason each slice's facets are: a
 * facet carries a `read` function over the slice's row type, which makes it behaviour rather than copy.
 * Module scope is load-bearing — `AdminCrudView`'s memo and the react-aria collection behind it both key
 * on the array's identity.
 *
 * **The Saison facet is why this file exists** (decided 2026-08-07). The club list shows EVERY club across
 * every season with the selected season's junction data beside it, which is right — a club is
 * season-independent and the list is the only surface that can say so. But an admin arriving from a
 * season's row wanted that season's clubs, and there was no way to ask for them. Now there is, and the
 * default is still every club, so nothing about the list's meaning changed.
 */

import { GRUPPEN_OPTIONS } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminTeamRow } from "./types";

export const TEAM_FACETS: readonly Facet<AdminTeamRow>[] = [
  {
    param: "zugehoerigkeit",
    label: "Saison",
    options: [
      { value: "aufgenommen", label: "In dieser Saison" },
      { value: "nicht_aufgenommen", label: "Nicht in dieser Saison" },
    ],
    // The selected season's junction row is the page's own `selected`, so this facet asks a question
    // about the season the sidemenu holds rather than about a season of its own.
    read: (team) => [team.selected === null ? "nicht_aufgenommen" : "aufgenommen"],
  },
  {
    param: "gruppe",
    label: "Gruppe",
    options: GRUPPEN_OPTIONS.map((gruppe) => ({ value: gruppe, label: `Gruppe ${gruppe}` })),
    // A club with no junction row for the selected season holds no group, so it matches no option here
    // and is filtered out the moment any group is picked. That is the honest answer: it is not in a group.
    read: (team) => (team.selected === null ? [] : [team.selected.gruppe]),
  },
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "disqualifiziert", label: "Disqualifiziert" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    // Not mutually exclusive, and deliberately not modelled as if they were: a retired club can also
    // carry a disqualification from a season it played, and both facts are worth filtering on. `aktiv` is
    // the absence of both.
    read: (team) => {
      const held: string[] = [];
      if (team.inactive_since !== null) held.push("stillgelegt");
      if (team.selected?.disqualifikation != null) held.push("disqualifiziert");
      if (held.length === 0) held.push("aktiv");
      return held;
    },
  },
];
