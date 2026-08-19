"use client";

import { useSearchParams } from "next/navigation";

import { readFacetSelection } from "@/shared/utils/facets";

import type { Facet, FacetSelection } from "@/shared/utils/facets";

/**
 * What the URL currently selects, for a list that narrows itself by it — separate from `useUrlFilters` because the list
 * wants the selection and nothing else. A caller needing the active count derives it with `countActiveFacets`.
 */
export function useFacetSelection<TItem>(facets: readonly Facet<TItem>[]): FacetSelection {
  const searchParams = useSearchParams();

  return readFacetSelection(facets, new URLSearchParams(searchParams.toString()));
}
