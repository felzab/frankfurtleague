"use client";

/**
 * SHARED · the filter bar's URL state
 *
 * The other half of `useDebouncedUrlQuery`: that hook owns `?q=`, this one owns one parameter per facet.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **The URL is the only state.** There is no `useState` here, so a selection survives a reload, a
 *     back button and a shared link, and two halves of the page cannot disagree about it. It is the same
 *     reason `AdminSpieleActionRequiredView` keeps its section there.
 *   • **It writes with `window.history.replaceState`, not `router.replace`.** Every surface that filters
 *     already holds all its rows on the client, so a router navigation would re-render the route's server
 *     component — and on the CRUD pages re-issue its reads — to change which of the already-loaded rows
 *     are displayed. Next documents the History API as integrating with its router, so `useSearchParams`
 *     re-renders with the new value and nothing else runs.
 *   • `replaceState`, never `pushState`. Back out of a filtered list should leave the list, not walk the
 *     user backwards through the facets they tried.
 *   • **A write touches only the parameters it names, and reads the LIVE URL for the rest.** Both halves
 *     are needed and for the same reason: `replaceState` updates the address bar synchronously while
 *     `useSearchParams` re-renders afterwards, so a second press arriving before that render is working
 *     from a stale snapshot. Naming only what changed means the stale part is never written back.
 *   • A value the facet does not offer is dropped on read (`readFacetSelection`), so a hand-edited query
 *     string cannot select something the popover has no row for.
 *   • **The returned selection is not referentially stable and must not be depended on as if it were.**
 *     It is rebuilt per render from the params, like `useDebouncedUrlQuery`'s `urlValue` — which is why
 *     `applyFacets` returns its input unchanged when nothing is selected.
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
