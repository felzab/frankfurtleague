"use client";

/**
 * SHARED · the search query in the URL
 *
 * The read half of the app's `?q=` — what a list narrows itself by, for a component that renders no
 * field.
 *
 * Invariants:
 * - An absent parameter and an empty one read alike, so no consumer needs a second empty check.
 */
import { useSearchParams } from "next/navigation";

/** The parameter every search field in this app writes and every list reads. */
export const QUERY_PARAM = "q";

/**
 * The search parameter's current value.
 *
 * Separate from `useDebouncedUrlQuery` because reading and writing this parameter need different
 * machinery: a field owes the URL a debounce and a locally held draft between keystrokes, and a list
 * that merely narrows itself owes it neither.
 */
export function useUrlQuery(param: string = QUERY_PARAM): string {
  // `||` rather than `??`: `?q=` with nothing after it is not a query, and `""` is what every consumer
  // already treats as "nothing was asked".
  return useSearchParams().get(param) || "";
}
