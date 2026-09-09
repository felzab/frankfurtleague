import { readFacetSelectionFromRoute } from "@/shared/utils/facets";

import { AKTION_COLLECTION_LABELS, AKTION_HERKUNFT_LABELS, AKTION_OPERATION_LABELS } from "./constants";
import { herkunftOfAktor } from "./utils";

import type { Facet, FacetCounts } from "@/shared/utils/facets";
import type { FLAktionenListResponse } from "./schemas";
import type { AdminAktionRow } from "./types";

/**
 * Spelled as `fl_backend/app/api/aktionen/schemas.py :: FLAktionenFilterParams` spells its own terms,
 * so a selection is forwarded rather than translated: a second spelling is a mapping table to drift.
 */
export const AKTIONEN_COLLECTION_PARAM = "collection";
export const AKTIONEN_OPERATION_PARAM = "operation";
export const AKTIONEN_HERKUNFT_PARAM = "herkunft";

// Derived from the label maps rather than spelled a second time: an area, an operation or an origin
// added there has to reach this filter, and two hand-kept lists drift the moment one of them grows.
const toOptions = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

// Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
// key on the array's identity.
export const AKTIONEN_FACETS: readonly Facet<AdminAktionRow>[] = [
  {
    param: AKTIONEN_COLLECTION_PARAM,
    label: "Bereich",
    options: toOptions(AKTION_COLLECTION_LABELS),
    // The endpoint narrows on it, so picking an area reaches the areas the cap left out rather than
    // filtering the newest page down to whatever of them happens to be on it.
    narrowsTheRead: true,
    read: (aktion) => [aktion.collection],
  },
  {
    param: AKTIONEN_OPERATION_PARAM,
    label: "Art",
    options: toOptions(AKTION_OPERATION_LABELS),
    narrowsTheRead: true,
    read: (aktion) => [aktion.operation],
  },
  {
    param: AKTIONEN_HERKUNFT_PARAM,
    label: "Herkunft",
    options: toOptions(AKTION_HERKUNFT_LABELS),
    // Every dimension narrows the read, or a told count ignores a selection the endpoint never saw:
    // the cap is applied before that narrowing, so the two cannot be composed and an area's number
    // would lead to an empty page.
    narrowsTheRead: true,
    // On the actor's `kind` and never on the address: two of the three carry a sentinel rather than a
    // mailbox, and a later scheme that verifies an identity records a new kind under `person`.
    read: (aktion) => [herkunftOfAktor(aktion.actor)],
  },
];

/**
 * What `GET /aktionen` is asked to narrow to, comma-joined for the wire and `undefined` for everything.
 * The bar's own reader answers it, so the served rows and the pills cannot disagree about one query string.
 */
export function aktionenLogFacetTerms(params: Readonly<Record<string, string | string[] | undefined>>): {
  collection?: string;
  operation?: string;
  herkunft?: string;
} {
  const selection = readFacetSelectionFromRoute(AKTIONEN_FACETS, params);

  return {
    collection: selection[AKTIONEN_COLLECTION_PARAM]?.join(","),
    operation: selection[AKTIONEN_OPERATION_PARAM]?.join(","),
    herkunft: selection[AKTIONEN_HERKUNFT_PARAM]?.join(","),
  };
}

/**
 * The endpoint's own counts, paired with the parameter each answers for. Every facet is present, or
 * `FilterPanel` counts the missing one off the rows served — which the cap already cut.
 */
export function aktionenLogFacetCounts(
  counts: Pick<FLAktionenListResponse, "anzahl_je_collection" | "anzahl_je_operation" | "anzahl_je_herkunft">,
): FacetCounts {
  return {
    [AKTIONEN_COLLECTION_PARAM]: counts.anzahl_je_collection,
    [AKTIONEN_OPERATION_PARAM]: counts.anzahl_je_operation,
    [AKTIONEN_HERKUNFT_PARAM]: counts.anzahl_je_herkunft,
  };
}
