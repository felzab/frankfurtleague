/**
 * A place's map, as another site's search for it. It takes a string rather than a domain object, since its callers
 * search for genuinely different lines.
 */
export function buildMapsSearchUrl(query: string): `https://${string}` {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
