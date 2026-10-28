/**
 * The name a search query took in a URL. No page writes one; one a
 * bookmark still holds is left behind by every URL built from the current one.
 */
export const SEARCH_QUERY_PARAM = "q";

/** A copy of `search` for the next URL to be built from, with any search query left out. */
export function withoutSearchQuery(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete(SEARCH_QUERY_PARAM);

  return next;
}
