"use client";

import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { countActiveFacets } from "@/shared/utils/facets";

import { useFacetSelection } from "./useFacetSelection";

import type { Facet } from "@/shared/utils/facets";

/**
 * The parameter-per-facet counterpart to `?q=`. The URL is the only state, so a selection survives reload and a shared
 * link, and the selection is `useFacetSelection`'s so a list and its bar cannot read one URL differently.
 */
export function useUrlFilters<TItem>(facets: readonly Facet<TItem>[]) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const selection = useFacetSelection(facets);

  /**
   * The order the filters were added in. `URLSearchParams.set` replaces an existing key in place and appends a new one,
   * and `toString` sorts nothing, so insertion order is already recorded in the URL and needs no second home.
   */
  const paramOrder = [...searchParams.keys()];

  /**
   * Reads the live URL rather than this render's snapshot. `replaceState` rather than `router.replace`, whose
   * navigation re-runs the route's server reads; and never `pushState`, since back should leave the list.
   */
  const write = useCallback(
    (changes: Readonly<Record<string, readonly string[]>>) => {
      const params = new URLSearchParams(window.location.search);

      for (const [param, picked] of Object.entries(changes)) {
        // Deleted rather than emptied, so a shared link carries only what somebody actually chose.
        if (picked.length === 0) params.delete(param);
        else params.set(param, picked.join(","));
      }

      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );

  /** Replaces one facet's selection wholesale, which is what a multi-select ListBox reports. */
  const setFacet = useCallback(
    (param: string, values: readonly string[]) => {
      write({ [param]: values });
    },
    [write],
  );

  const clearFacet = useCallback(
    (param: string) => {
      write({ [param]: [] });
    },
    [write],
  );

  /** Every facet at once, named explicitly so a parameter that is not a facet survives. */
  const clearAll = useCallback(() => {
    write(Object.fromEntries(facets.map((facet) => [facet.param, []])));
  }, [facets, write]);

  return { selection, paramOrder, activeCount: countActiveFacets(selection), setFacet, clearFacet, clearAll };
}
