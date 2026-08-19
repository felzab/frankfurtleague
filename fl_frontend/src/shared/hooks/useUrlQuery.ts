"use client";

import { useSearchParams } from "next/navigation";

/** The parameter every search field in this app writes and every list reads. */
export const QUERY_PARAM = "q";

/**
 * The read half of `?q=`, separate from `useDebouncedUrlQuery` because a field owes the URL a debounce and a locally
 * held draft between keystrokes where a list that merely narrows itself owes neither.
 */
export function useUrlQuery(param: string = QUERY_PARAM): string {
  // `||` rather than `??`, so an absent parameter and an empty one read alike and no consumer needs a second check.
  return useSearchParams().get(param) || "";
}
