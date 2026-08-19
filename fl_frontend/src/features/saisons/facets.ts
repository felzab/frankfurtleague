import { GRUPPEN_OPTIONS } from "@/features/teams/constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminSaisonRow } from "./types";

export const SAISON_FACETS: readonly Facet<AdminSaisonRow>[] = [
  {
    param: "status",
    label: "Status",
    // Stored values verbatim, in the order a season passes through them rather than alphabetically.
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
    // The group COUNT rather than a group name, over the values `rules.number_of_groups` can hold.
    options: GRUPPEN_OPTIONS.map((_, index) => ({
      value: String(index + 1),
      label: index === 0 ? "1 Gruppe" : `${String(index + 1)} Gruppen`,
    })),
    read: (saison) => [String(saison.rules.number_of_groups)],
  },
];
