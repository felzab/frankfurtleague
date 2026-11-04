/**
 * A place's map, as another site's search for it: a venue's on the match pop-up and the match page, a club's on its
 * page. It takes a string rather than a domain object, since its callers search for genuinely different lines.
 */
export function buildMapsSearchUrl(query: string): `https://${string}` {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
