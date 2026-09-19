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
 * A day as this site prints one, which is the spelling a reader types. At `threshold: 0.3` every
 * other date of the same month is within edit distance of it, so a fuzzy match answers its neighbours.
 */
const COMPLETE_DATE = /^\d{2}\.\d{2}\.\d{4}$/;

/** A query parted into the dates it names and whatever else it asks for. */
export function splitDateQuery(query: string): { dates: string[]; rest: string } {
  const tokens = query.split(/\s+/).filter((token) => token !== "");

  return {
    dates: tokens.filter((token) => COMPLETE_DATE.test(token)),
    rest: tokens.filter((token) => !COMPLETE_DATE.test(token)).join(" "),
  };
}

/** Every string one searched key reaches on an item, a dotted path walked and an array flattened. */
function valuesAt(item: unknown, path: string): string[] {
  let reached: unknown[] = [item];

  for (const step of path.split(".")) {
    reached = reached.flatMap((at) => (typeof at === "object" && at !== null ? [(at as Record<string, unknown>)[step]] : []));
  }

  return reached.flat().filter((value) => typeof value === "string");
}

/** Whether an item carries each date on some searched key, written exactly as the query spells it. */
export function carriesEveryDate(item: unknown, keys: readonly string[], dates: readonly string[]): boolean {
  return dates.every((date) => keys.some((key) => valuesAt(item, key).includes(date)));
}

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

    const { dates, rest } = splitDateQuery(query);
    const narrowed = dates.length === 0 ? items : items.filter((item) => carriesEveryDate(item, keys, dates));

    if (rest === "") return narrowed;
    // The memoised index where nothing was narrowed away, and a fresh one over what a date left: the
    // second is built only for a query naming one, over the handful of rows that day holds.
    const over = narrowed === items ? fuse : new Fuse(narrowed, { ...FUSE_DEFAULTS, keys: [...keys] } as IFuseOptions<T>);

    return over.search(rest).map((result) => result.item);
  }, [fuse, query, items, keys, emptyQuery, empty]);
}
