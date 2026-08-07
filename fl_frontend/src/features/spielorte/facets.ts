/**
 * SPIELORTE · what the admin venue list can be narrowed by
 *
 * Module scope is load-bearing — see `TEAM_FACETS`.
 *
 * **`stadtteil` is not a facet, for the reason `schule` is not one on the referee list**: it is free text
 * with no closed set behind it, so the options would be whatever spellings exist and every near-duplicate
 * would look like a district with no venues. The search field finds a district by name.
 *
 * **`default_mietpreis` is banded rather than offered as values.** A price is a number, and a facet over
 * distinct numbers is a facet with one item in most of its rows; three bands answer the question somebody
 * actually has, which is whether a venue is free.
 */

import type { Facet } from "@/shared/utils/facets";
import type { FLSpielort } from "./schemas";

export const SPIELORT_FACETS: readonly Facet<FLSpielort>[] = [
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    read: (ort) => [ort.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
  {
    param: "miete",
    label: "Mietpreis",
    options: [
      { value: "kostenlos", label: "Kostenlos" },
      { value: "bis_100", label: "Bis 100 €" },
      { value: "ueber_100", label: "Über 100 €" },
    ],
    // The bands are exclusive and exhaustive over a non-negative integer, so every venue matches exactly
    // one and the three counts add up to the list. `mietpreis` on a Spiel is a point-in-time copy and is
    // deliberately not what this reads (ADR-0028 rule 2).
    read: (ort) => {
      if (ort.default_mietpreis === 0) return ["kostenlos"];
      return ort.default_mietpreis <= 100 ? ["bis_100"] : ["ueber_100"];
    },
  },
];
