"use client";

/**
 * SHARED · fuzzy search
 *
 * The app's single Fuse configuration and the only place a search index is built.
 *
 * Invariants:
 * - Both stages stay memoized — call sites this replaced rebuilt the index per keystroke.
 * - The returned array keeps identity across renders — react-aria collections stop committing
 *   otherwise, so callers pass a module-scope `keys` array.
 */
import { useMemo } from "react";

import Fuse from "fuse.js";

import type { IFuseOptions } from "fuse.js";

const FUSE_DEFAULTS = {
  threshold: 0.3,
  distance: 100,
  ignoreLocation: true,
  minMatchCharLength: 1,
} as const;

/**
 * One Fuse configuration, memoized in both stages. Two of the three former call
 * sites rebuilt the index and re-ran the search on every keystroke render.
 *
 * `emptyQuery` is an explicit option because the call sites genuinely disagree and both are
 * intended: the admin views list everything until you type ("all"), while `/dashboard/spielsuche`
 * deliberately shows "Noch keine Eingabe..." until you do ("none").
 *
 * Memoizing the result is what keeps the collection stable: the returned array must hold its identity
 * across the re-renders `useSearchParams` triggers while the view sits in a hidden Activity tree, or
 * a react-aria collection fed from it stops committing its rows. Pass a module-scope `keys` array
 * for the same reason.
 */
export function useFuzzySearch<T>({
  items,
  keys,
  query,
  emptyQuery = "all",
}: {
  items: T[];
  keys: readonly string[];
  query: string;
  emptyQuery?: "all" | "none";
}): T[] {
  const fuse = useMemo(() => new Fuse(items, { ...FUSE_DEFAULTS, keys: [...keys] } as IFuseOptions<T>), [items, keys]);

  const empty = useMemo<T[]>(() => [], []);

  return useMemo(() => {
    if (!query) return emptyQuery === "all" ? items : empty;
    return fuse.search(query).map((result) => result.item);
  }, [fuse, query, items, emptyQuery, empty]);
}
