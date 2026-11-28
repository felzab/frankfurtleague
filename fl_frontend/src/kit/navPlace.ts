import { ROUTES } from "@/core/routes";

/**
 * The entry the address belongs to: the longest one the path equals or lies under, so an area's Übersicht
 * is not marked on a page beneath it that has an entry of its own.
 */
export function currentOf<Href extends string>(path: string, hrefs: ReadonlyArray<Href>) {
  return hrefs
    .filter((href) => path === href || path.startsWith(`${href}/`))
    .reduce<Href | null>((best, href) => (best === null || href.length > best.length ? href : best), null);
}

/** The rows declaring the page their page belongs to: a season's editors, its applications' pages, and Konto's. */
const PLACED = Object.values(ROUTES).filter((row) => "place" in row);

/**
 * Whether the path is the row's page in this season, segment by segment against the pattern it declares: `[saison]`
 * the season, which an address naming none never matches, any other dynamic segment, a record's id, any one segment,
 * and every other segment itself.
 */
function isPageOf(row: (typeof PLACED)[number], saison: string | undefined, path: string) {
  const pattern = row.place.pattern.split("/");
  const segments = path.split("/");
  return (
    pattern.length === segments.length &&
    pattern.every((segment, index) =>
      segment === "[saison]" ? segments[index] === saison : segment.startsWith("[") || segment === segments[index],
    )
  );
}

/**
 * The address of the page the path's route declares its page belongs to (`RouteEntry.place`), or `undefined` where it
 * declares none. The place's address takes the path's dynamic segments in the pattern's order, as many as it names: a
 * season's list the season alone, the league's list and Konto's none, a match editor the season and the match.
 * `saison` is the season the address names, if any.
 */
export function declaredPlaceOf(path: string, saison: string | undefined): string | undefined {
  const row = PLACED.find((each) => isPageOf(each, saison, path));
  if (row === undefined) return undefined;
  const segments = path.split("/");
  const values = row.place.pattern.split("/").flatMap((segment, index) => (segment.startsWith("[") ? [segments[index] ?? ""] : []));
  return (ROUTES[row.place.entry].path as (...given: string[]) => string)(...values);
}

/**
 * The entry a page belongs to: the one its route declares (`RouteEntry.place`), where its address lies under another
 * entry's, as a season's editor lies under the season's Übersicht and belongs to the season list; else the entry its
 * address lies under, as for a line-up, whose declared place, its match editor, is no entry of the menu. Read from the
 * route table rather than declared by the page, since the frame drawing the menu stands above every page and their
 * layouts, and the table is known to the server and the client alike, so the mark is right before the page hydrates.
 * `saison` is the season the address names, if any.
 */
export function placeOf<Href extends string>(path: string, saison: string | undefined, hrefs: ReadonlyArray<Href>) {
  const declared = declaredPlaceOf(path, saison);
  const own = declared === undefined ? undefined : hrefs.find((href) => href === declared);
  return own ?? currentOf(path, hrefs);
}
