import { Fragment } from "react";
import { usePathname } from "next/navigation";

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

/**
 * Its children afresh on every page: a sheet the layout keeps would otherwise stay open after one of its links
 * led on, since a layout outlives the page it surrounds.
 */
export function FreshPerPage({ children }: { children: ReactNode }) {
  return <Fragment key={usePathname()}>{children}</Fragment>;
}
