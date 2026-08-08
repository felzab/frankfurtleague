/**
 * SAISONS · what the admin season list can be narrowed by
 *
 * Module scope is load-bearing — see `TEAM_FACETS`.
 *
 * Two facets, which is the smallest set in the app and the reason the filter control had to work at that
 * size as well as at Spielsuche's seven: a league has two or three seasons, so `Aufbau` is here less to
 * narrow a list than to answer "which seasons ran four groups".
 */

import { GRUPPEN_OPTIONS } from "@/features/teams/constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminSaisonRow } from "./types";

export const SAISON_FACETS: readonly Facet<AdminSaisonRow>[] = [
  {
    param: "status",
    label: "Status",
    // The stored `status` verbatim, in the order a season passes through them rather than alphabetically.
    options: [
      { value: "active", label: "Laufend" },
      { value: "future", label: "Geplant" },
      { value: "past", label: "Abgeschlossen" },
    ],
    read: (saison) => [saison.status],
  },
  {
    param: "gruppen",
    label: "Aufbau",
    // The group COUNT, offered as the four values `rules.number_of_groups` can hold — the same closed A–D
    // prefix the season form bounds itself to.
    options: GRUPPEN_OPTIONS.map((_, index) => ({
      value: String(index + 1),
      label: index === 0 ? "1 Gruppe" : `${String(index + 1)} Gruppen`,
    })),
    read: (saison) => [String(saison.rules.number_of_groups)],
  },
];
