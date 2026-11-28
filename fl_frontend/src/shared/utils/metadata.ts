import { SITE_LOCALE } from "@/core/brand";
import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { SHARE_IMAGE } from "./shareImage";

import type { Copy, Words } from "@/core/copy";
import type { RouteEntry } from "@/core/routes";
import type { Metadata } from "next";

/**
 * The preview fields every page shares, which the root layout declares beside the share image. Open Graph spells the
 * locale with an underscore, `de_DE`.
 */
export const SITE_OPEN_GRAPH = { siteName: COPY.brand.name, locale: SITE_LOCALE.replace("-", "_"), type: "website" } as const;

/** A row whose address takes no segment, so its one address is read off the row. */
type FixedRow = RouteEntry & { readonly path: () => `/${string}` };

type PageWords = { readonly title?: Words; readonly description?: Copy };

/**
 * A page's metadata from its route's row and its address: the title, the description, the preview with the share
 * image and the address as og:url, which Meta's scraper takes as the shared object's identity, and either the address
 * as the canonical, on a page search engines list, or `noindex`, on one they do not: a canonical names the address to
 * list, which a page kept out of the index has none of, so it declares none, as Yoast leaves it off a noindex page. A
 * row titled by its record or its teams takes that title as `title`; a listed page takes its description from the
 * server catalogue, which holds one for a listed row alone. A row whose address takes no segment hands no address,
 * and a page that reads nothing exports the result as its `metadata`; a page with segments hands the address they
 * make from `generateMetadata`, since a constant would be decided once, at the build, for every address.
 */
export function pageMetadata(row: FixedRow & { readonly title: Copy }, words?: { readonly description?: Copy }): Metadata;
export function pageMetadata(row: FixedRow, words: { readonly title: Words; readonly description?: Copy }): Metadata;
export function pageMetadata(row: RouteEntry & { readonly title: Copy }, path: string, words?: { readonly description?: Copy }): Metadata;
export function pageMetadata(row: RouteEntry, path: string, words: { readonly title: Words; readonly description?: Copy }): Metadata;
export function pageMetadata(row: RouteEntry, pathOrWords: string | PageWords = {}, given: PageWords = {}): Metadata {
  // The overloads hand no address for a fixed row alone, whose `path` takes no segment.
  const [path, words] = typeof pathOrWords === "string" ? [pathOrWords, given] : [(row.path as FixedRow["path"])(), pathOrWords];
  return {
    title: words.title === undefined ? (typeof row.title === "string" ? row.title : undefined) : textOf(words.title),
    description: words.description,
    // Next replaces the parent's whole `openGraph` once a page declares one, so the image is spread here too.
    openGraph: { ...SITE_OPEN_GRAPH, ...SHARE_IMAGE, url: path },
    ...(row.crawl === "index" ? { alternates: { canonical: path } } : { robots: { index: false, follow: false } }),
  };
}
