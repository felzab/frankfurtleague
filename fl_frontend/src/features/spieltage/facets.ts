import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminSpieltagRow } from "./types";

export const SPIELTAG_FACETS: readonly Facet<AdminSpieltagRow>[] = [
  {
    param: "phase",
    label: "Phase",
    options: SAISON_PHASE_OPTIONS.map((phase) => ({ value: phase, label: PHASE_LABELS[phase] })),
    read: (spieltag) => [spieltag.saison_phase],
  },
  {
    param: "besetzung",
    label: "Spiele",
    options: [
      { value: "vollstaendig", label: "Vollständig angelegt" },
      { value: "unvollstaendig", label: "Weicht ab" },
    ],
    // The expected count is derived from the season's rules and nothing holds the two equal, so
    // „Weicht ab“ is the shortlist of matchdays that diverge.
    read: (spieltag) => [spieltag.spieleAngelegt === spieltag.anzahl_spiele ? "vollstaendig" : "unvollstaendig"],
  },
];
