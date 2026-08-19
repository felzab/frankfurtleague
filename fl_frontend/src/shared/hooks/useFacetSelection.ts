"use client";

/**
 * SHARED · the filter selection in the URL
 *
 * The read half of the filter bar's state — what is picked, for a component that renders no control.
 *
 * Invariants:
 * - A value the facet does not offer is dropped on read.
 * - The returned selection is referentially stable while the query string and the facets are —
 *   `readFacetSelection` owns that guarantee and states what rests on it.
 */
import { useSearchParams } from "next/navigation";

import { readFacetSelection } from "@/shared/utils/facets";

import type { Facet, FacetSelection } from "@/shared/utils/facets";

/**
 * What the URL currently selects, for a list that narrows itself by it.
 *
 * Separate from `useUrlFilters` because narrowing a list and operating the control are different jobs:
 * the list wants the selection and nothing else, while the bar also wants the order the parameters
 * were added in and the writers. A caller needing how many dimensions are active derives it from this
 * with `countActiveFacets`, which is a pure function of the selection rather than a second hook.
 */
export function useFacetSelection<TItem>(facets: readonly Facet<TItem>[]): FacetSelection {
  const searchParams = useSearchParams();

  return readFacetSelection(facets, new URLSearchParams(searchParams.toString()));
}
