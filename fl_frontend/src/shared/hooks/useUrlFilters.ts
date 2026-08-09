"use client";

/**
 * SHARED · the filter bar's URL state
 *
 * The other half of `useDebouncedUrlQuery`: that hook owns `?q=`, this one owns one parameter
 * per facet.
 *
 * Invariants:
 * - The URL is the only state — a selection survives reload, back button and a shared link.
 * - Writes use `replaceState`, not `router.replace` — the rows are already loaded, and a router
 *   navigation would re-run the route's server reads.
 * - `replaceState`, never `pushState` — back should leave the list, not walk the facets.
 * - A write names its parameters and reads the live URL for the rest — never a stale snapshot.
 * - A value the facet does not offer is dropped on read.
 * - The returned selection is rebuilt per render and is not referentially stable.
 */
import { useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { countActiveFacets, readFacetSelection } from "@/shared/utils/facets";

import type { Facet } from "@/shared/utils/facets";

export function useUrlFilters<TItem>(facets: readonly Facet<TItem>[]) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const selection = readFacetSelection(facets, new URLSearchParams(searchParams.toString()));

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

  /** Adds or removes one option of one facet. */
  const toggle = useCallback(
    (param: string, value: string) => {
      const picked = selection[param] ?? [];
      write({ [param]: picked.includes(value) ? picked.filter((held) => held !== value) : [...picked, value] });
    },
    [selection, write],
  );

  /** Replaces one facet's selection wholesale — what a multi-select ListBox reports. */
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

  return { selection, activeCount: countActiveFacets(selection), toggle, setFacet, clearFacet, clearAll };
}
