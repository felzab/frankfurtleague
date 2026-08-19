"use client";

/**
 * SHARED · the filter bar's URL state
 *
 * The parameter-per-facet counterpart to `?q=`, for the component that renders the controls: the
 * selection `useFacetSelection` reads, plus everything needed to change it.
 *
 * Invariants:
 * - The URL is the only state — a selection survives reload, back button and a shared link.
 * - Writes use `replaceState`, not `router.replace` — the rows are already loaded, and a router
 *   navigation would re-run the route's server reads.
 * - `replaceState`, never `pushState` — back should leave the list, not walk the facets.
 * - A write names its parameters and reads the live URL for the rest — never a stale snapshot.
 * - The selection is `useFacetSelection`'s, so the list and the bar narrowing it can never read the
 *   same URL differently.
 * - The URL carries the ORDER filters were added in, and `paramOrder` is how a caller reads it.
 */
import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { countActiveFacets } from "@/shared/utils/facets";

import { useFacetSelection } from "./useFacetSelection";

import type { Facet } from "@/shared/utils/facets";

export function useUrlFilters<TItem>(facets: readonly Facet<TItem>[]) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const selection = useFacetSelection(facets);

  /**
   * The parameters in the order the URL holds them, which is the order they were added in.
   *
   * `URLSearchParams.set` replaces an existing key in place and appends a new one, `delete` removes it
   * outright, and `toString` sorts nothing — so insertion order is already recorded here and needs no
   * second home. A dimension cleared and picked again is a new key, and lands at the end.
   */
  const paramOrder = [...searchParams.keys()];

  /**
   * Writes the named facets and leaves every other parameter — facet or not — exactly as the URL has it.
   *
   * The base is `window.location.search` rather than this render's `searchParams`; see the invariant.
   */
  const write = useCallback(
    (changes: Readonly<Record<string, readonly string[]>>) => {
      const params = new URLSearchParams(window.location.search);

      for (const [param, picked] of Object.entries(changes)) {
        // Deleted rather than set to an empty string, so an untouched facet leaves no trace in the URL
        // and a shared link carries only what somebody actually chose.
        if (picked.length === 0) params.delete(param);
        else params.set(param, picked.join(","));
      }

      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );

  /**
   * Replaces one facet's selection wholesale — what a multi-select ListBox reports, and the only
   * shape the panel needs: a checkbox flipped inside it changes the whole set it reports back.
   */
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
