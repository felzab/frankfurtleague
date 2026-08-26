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
];
