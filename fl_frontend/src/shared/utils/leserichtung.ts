/**
 * Which end of a capped read a list keeps. The default keeps the NEWEST, so a flood buries the older
 * genuine rows; reversing is the one thing that puts them back in the window.
 */
export type Leserichtung = "asc" | "desc";

const ORDER_PARAM = "order";

/** Anything else reads as the default, so a hand-edited URL falls back rather than 404s. */
export function parseLeserichtung(params: Readonly<Record<string, string | string[] | undefined>>): Leserichtung {
  return params[ORDER_PARAM] === "asc" ? "asc" : "desc";
}

/**
 * The other end. Named rather than spelled at each call site, where a ternary can return the
 * direction it was handed and no type refuses it.
 */
export function umgekehrt(richtung: Leserichtung): Leserichtung {
  return richtung === "asc" ? "desc" : "asc";
}

/**
 * The search string that reads from `ziel` — the TARGET end, never the current one, so a control offering
 * both ends and a link offering the other share one builder.
 */
export function leserichtungHref(search: URLSearchParams, ziel: Leserichtung): string {
  // Copied rather than rebuilt, so reversing never silently drops the search text or a facet.
  const next = new URLSearchParams(search);
  next.delete(ORDER_PARAM);
  // The default end is the ABSENCE of the parameter, as `SaisonSelector` and `useUrlFilters` spell
  // theirs: a shared link carries only what somebody chose.
  if (ziel === "asc") next.set(ORDER_PARAM, "asc");

  // Never empty, so the two routes to one state write one href: a bare `?` resolves to this path with
  // no query, and Next's canonical URL drops the character.
  return `?${next.toString()}`;
}

/** The same off a Server Component's `searchParams`, the shape `readFacetSelectionFromRoute` takes. */
export function leserichtungHrefFromRoute(params: Readonly<Record<string, string | string[] | undefined>>, ziel: Leserichtung): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) search.append(key, single);
  }

  return leserichtungHref(search, ziel);
}
