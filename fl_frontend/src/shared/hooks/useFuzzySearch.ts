"use client";

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
 * The app's one Fuse configuration, memoised in both stages. **The returned array must hold its identity** across the
 * re-renders `useSearchParams` triggers in a hidden Activity tree, or the collection fed from it stops committing rows.
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
