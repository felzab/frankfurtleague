/**
 * SCHIEDSRICHTER · what the admin referee list can be narrowed by
 *
 * Module scope is load-bearing — see `TEAM_FACETS`.
 *
 * **`schule` is not a facet, and that is a decision about the data rather than about the UI.** It is a
 * nullable free-text field with no closed set behind it, so its options would be whatever spellings have
 * been typed — and a filter offering „Helmholtzschule“ beside „Helmholtz-Schule“ teaches the reader that
 * one of them is missing referees. The search field already finds a school by name; what a facet can
 * honestly say about it is whether one is recorded at all.
 */

import type { Facet } from "@/shared/utils/facets";
import type { FLSchiedsrichter } from "./schemas";

export const SCHIEDSRICHTER_FACETS: readonly Facet<FLSchiedsrichter>[] = [
  {
    param: "status",
    label: "Status",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    read: (schiedsrichter) => [schiedsrichter.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
  {
    param: "angaben",
    label: "Angaben",
    options: [
      { value: "kontakt", label: "Kontakt hinterlegt" },
      { value: "ohne_kontakt", label: "Ohne Kontakt" },
      { value: "schule", label: "Schule hinterlegt" },
    ],
    // What is missing, which is the useful question about a reference list: `kontakt` is required to be
    // PRESENT and never to be filled in, so a referee with neither a phone number nor an email address is
    // a normal document and a real gap.
    read: (schiedsrichter) => {
      const held: string[] = [];
      const hasKontakt = schiedsrichter.kontakt.email !== null || schiedsrichter.kontakt.telefon !== null;
      held.push(hasKontakt ? "kontakt" : "ohne_kontakt");
      if (schiedsrichter.schule !== null) held.push("schule");
      return held;
    },
  },
];
