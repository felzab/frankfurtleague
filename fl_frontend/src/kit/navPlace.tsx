import { Fragment } from "react";
import { usePathname } from "next/navigation";

import { ROUTES } from "@/core/routes";

import type { ReactNode } from "react";

/**
 * The entry the address belongs to: the longest one the path equals or lies under, so an area's Übersicht
 * is not marked on a page beneath it that has an entry of its own.
 */
export function currentOf<Href extends string>(path: string, hrefs: ReadonlyArray<Href>) {
  return hrefs
    .filter((href) => path === href || path.startsWith(`${href}/`))
    .reduce<Href | null>((best, href) => (best === null || href.length > best.length ? href : best), null);
}

type Row = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * The rows declaring the entry their page belongs to, each a season's page, its address built from the season and, for
 * a record's page, the record's id after it.
 */
const PLACED = Object.values(ROUTES).filter((row): row is Extract<Row, { place: string }> => "place" in row);

/** A segment no address holds, standing for any one segment of the address in a placed row's pattern. */
const ANY_SEGMENT = "\u0000";

/**
 * Whether the path is the row's page in this season: segment by segment, the season filled in and every further
 * segment the row's address takes, a record's id, matching any one.
 */
function isPageOf(row: (typeof PLACED)[number], saison: string, path: string) {
  const ids = Array.from({ length: Math.max(0, row.path.length - 1) }, () => ANY_SEGMENT);
  const pattern = (row.path as (...segments: string[]) => string)(saison, ...ids).split("/");
  const segments = path.split("/");
  return pattern.length === segments.length && pattern.every((segment, index) => segment === ANY_SEGMENT || segment === segments[index]);
}

/**
 * The entry a page belongs to: the one its route declares (`RouteEntry.place`), where its address lies under another
 * entry's, as a season's editor lies under the season's Übersicht and belongs to the season list; else the entry its
 * address lies under. Read from the route table rather than declared by the page, since the frame drawing the menu
 * stands above every page and their layouts, and the table is known to the server and the client alike, so the
 * mark is right before the page hydrates. `saison` is the season the address names, if any.
 */
export function placeOf<Href extends string>(path: string, saison: string | undefined, hrefs: ReadonlyArray<Href>) {
  const row = saison === undefined ? undefined : PLACED.find((each) => isPageOf(each, saison, path));
  if (row !== undefined && saison !== undefined) {
    // A place that is a season's page takes the season, and one that is the league's ignores it.
    const declared = (ROUTES[row.place].path as (season: string) => string)(saison);
    const own = hrefs.find((href) => href === declared);
    if (own !== undefined) return own;
  }
  return currentOf(path, hrefs);
}

/**
 * Its children afresh on every page: a sheet the layout keeps would otherwise stay open after one of its links
 * led on, since a layout outlives the page it surrounds.
 */
export function FreshPerPage({ children }: { children: ReactNode }) {
  return <Fragment key={usePathname()}>{children}</Fragment>;
}
