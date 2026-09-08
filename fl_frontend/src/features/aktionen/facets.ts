import { leserichtungHref, parseLeserichtung } from "@/features/bewerbungen/utils";
import { readFacetSelectionFromRoute } from "@/shared/utils/facets";

import { AKTION_COLLECTION_LABELS, AKTION_HERKUNFT_LABELS, AKTION_OPERATION_LABELS } from "./constants";
import { herkunftOfAktor } from "./utils";

import type { Leserichtung } from "@/features/bewerbungen/utils";
import type { Facet } from "@/shared/utils/facets";
import type { AdminAktionRow } from "./types";

/**
 * Spelled as `fl_backend/app/api/aktionen/schemas.py :: FLAktionenFilterParams` spells its own terms,
 * so a selection is forwarded rather than translated: a second spelling is a mapping table to drift.
 */
export const AKTIONEN_COLLECTION_PARAM = "collection";
export const AKTIONEN_OPERATION_PARAM = "operation";

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
    // No `narrowsTheRead`: the endpoint takes no term for the actor's kind, so this one narrows the
    // rows already served.
    param: "herkunft",
    label: "Herkunft",
    options: toOptions(AKTION_HERKUNFT_LABELS),
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
} {
  const selection = readFacetSelectionFromRoute(AKTIONEN_FACETS, params);

  return {
    collection: selection[AKTIONEN_COLLECTION_PARAM]?.join(","),
    operation: selection[AKTIONEN_OPERATION_PARAM]?.join(","),
  };
}

// `leserichtungHref` and never a second builder: the applications queue offers the same control, and
// two implementations drift on the parameters only one of the two surfaces has.
/**
 * Read from the LIVE query string rather than the route's: the origin facet narrows no read, so
 * picking one writes history without a navigation, and a server-built href would drop it.
 */
export function aktionenLeserichtung(search: URLSearchParams): { richtung: Leserichtung; umkehrHref: string } {
  const roh: Record<string, string | string[]> = {};
  for (const key of new Set(search.keys())) {
    // A repeated key survives as the array `leserichtungHref` re-appends; a single one stays a string.
    const values = search.getAll(key);
    roh[key] = values.length > 1 ? values : values[0]!;
  }

  const richtung = parseLeserichtung(roh);

  return { richtung: richtung, umkehrHref: leserichtungHref(roh, richtung) };
}
