"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
  const router = useRouter();
  // The navigation below runs in a transition, so React keeps the list on screen and interactive
  // instead of replacing the streamed-in region with its fallback while the new rows are fetched.
  const [, startNarrowing] = useTransition();

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
        if (picked.length > 0) {
          params.set(param, picked.join(","));
          continue;
        }

        // Deleted rather than emptied, so a shared link carries only what somebody actually chose — except behind a
        // default, where deleting hands the facet straight back to it and nothing the reader does could turn it off.
        const isDefaulted = facets.some((facet) => facet.param === param && (facet.defaultValues?.length ?? 0) > 0);
        if (isDefaulted) params.set(param, "");
        else params.delete(param);
      }

      const query = params.toString();
      const href = query ? `${pathname}?${query}` : pathname;

      // The exception, and the whole reason a facet declares it: this parameter decided which rows
      // the page fetched, so writing history alone would leave the client filtering a set chosen
      // under the old selection.
      const refetches = facets.some((facet) => facet.narrowsTheRead === true && facet.param in changes);
      if (!refetches) {
        window.history.replaceState(null, "", href);
        return;
      }

      // `scroll: false`, as the search field's own write is: narrowing a list the reader is looking at must not
      // send them back to the top of it.
      startNarrowing(() => {
        router.replace(href, { scroll: false });
      });
    },
    [facets, pathname, router],
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

  /**
   * Every facet at once, named explicitly so a parameter that is not a facet survives. A default goes with them:
   * the control promises a complete list, and one left standing would still draw a pill.
   */
  const clearAll = useCallback(() => {
    write(Object.fromEntries(facets.map((facet) => [facet.param, []])));
  }, [facets, write]);

  return { selection, paramOrder, activeCount: countActiveFacets(selection), setFacet, clearFacet, clearAll };
}
