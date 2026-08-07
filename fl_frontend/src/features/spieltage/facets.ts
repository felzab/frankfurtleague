/**
 * SPIELTAGE · what the admin matchday list can be narrowed by
 *
 * Module scope is load-bearing — see `TEAM_FACETS`.
 *
 * **The phase facet coexists with the list's phase sections rather than duplicating them.** The sections
 * are how a reader takes the whole season in; the facet is how they get one phase on its own, which on a
 * season with twelve group matchdays and three knockout rounds is a different act.
 */

import { PHASE_LABELS } from "@/features/saisons/constants";

import { SAISON_PHASE_OPTIONS } from "./constants";

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
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    read: (spieltag) => [spieltag.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
  {
    param: "besetzung",
    label: "Spiele",
    options: [
      { value: "vollstaendig", label: "Vollständig angelegt" },
      { value: "unvollstaendig", label: "Weicht ab" },
    ],
    // The one fact only this surface can catch, made filterable: `anzahl_spiele` is hand-maintained and
    // never derived, so „Weicht ab“ is the shortlist of matchdays whose stored count disagrees with the
    // fixtures actually attached (ADR-0063).
    read: (spieltag) => [spieltag.spieleAngelegt === spieltag.anzahl_spiele ? "vollstaendig" : "unvollstaendig"],
  },
];
