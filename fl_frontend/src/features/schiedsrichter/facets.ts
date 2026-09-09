import { readFacetSelectionFromRoute } from "@/shared/utils/facets";

import { FLSchiedsrichterAngabeSchema } from "./schemas";

import type { Facet, FacetCounts } from "@/shared/utils/facets";
import type { FLSchiedsrichter, FLSchiedsrichterAngabe, FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

/** Spelled once: the read widens on this parameter's own `geloescht`, and the endpoint counts under its name. */
export const SCHIEDSRICHTER_ANGABEN_PARAM = "angaben";

/**
 * Keyed by the endpoint's closed set rather than listed beside it, so an option added there without a
 * label here fails to compile instead of shipping a chip nobody can read.
 */
const ANGABEN_LABELS: Record<FLSchiedsrichterAngabe, string> = {
  kontakt: "Mit Kontakt",
  ohne_kontakt: "Ohne Kontakt",
  schule: "Mit Schule",
  geloescht: "Daten gelöscht",
};

// Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
// key on the array's identity.
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
    param: SCHIEDSRICHTER_ANGABEN_PARAM,
    label: "Angaben",
    options: FLSchiedsrichterAngabeSchema.options.map((value) => ({ value: value, label: ANGABEN_LABELS[value] })),
    // `geloescht` is off the default read, so picking it has to fetch again rather than filter what
    // is already loaded; the other three narrow rows this page already holds.
    narrowsTheRead: true,
    read: (schiedsrichter): FLSchiedsrichterAngabe[] => {
      const held: FLSchiedsrichterAngabe[] = [];
      // `kontakt` is required to be present and never to be filled in, so a referee with neither a
      // phone number nor an email address is a normal document and a real gap.
      const hasKontakt = schiedsrichter.kontakt.email !== null || schiedsrichter.kontakt.telefon !== null;
      held.push(hasKontakt ? "kontakt" : "ohne_kontakt");
      if (schiedsrichter.schule !== null) held.push("schule");
      // Off the erasure's own stamp, never off an empty contact block, which most referees have anyway.
      if (schiedsrichter.anonymisiert_am !== null) held.push("geloescht");
      return held;
    },
  },
];

/**
 * What the referee list asks `GET /schiedsrichter` for, read off the bar's own selection so the served
 * rows and the pills cannot disagree about one query string.
 */
export function schiedsrichterListTerms(params: Readonly<Record<string, string | string[] | undefined>>): FLSchiedsrichterFilterParams {
  const selection = readFacetSelectionFromRoute(SCHIEDSRICHTER_FACETS, params);

  return {
    // Retired included: this list is the only surface that can bring one back.
    include_inactive: true,
    // A widening and never a filter of its own — picking it beside `Mit Kontakt` has to leave both
    // sets reachable, which is what OR within a facet promises.
    include_anonymisiert: selection[SCHIEDSRICHTER_ANGABEN_PARAM]?.includes("geloescht") ?? false,
  };
}

/**
 * The endpoint's own counts, under the parameter they answer for. Every facet the read narrows on is
 * present, or `FilterPanel` counts the missing one off the rows served — which is the set the erased
 * were left out of.
 */
export function schiedsrichterFacetCounts(counts: Pick<FLSchiedsrichterListResponse, "anzahl_je_angabe">): FacetCounts {
  return { [SCHIEDSRICHTER_ANGABEN_PARAM]: counts.anzahl_je_angabe };
}
