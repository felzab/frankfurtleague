import { COPY, textOf } from "@/core/copy";

import type { Copy, Words } from "@/core/copy";
import type { RouteEntry } from "@/core/routes";
import type { Metadata, ResolvingMetadata } from "next";

/**
 * The preview fields every page shares, which the root layout declares. Their image is
 * `fl_frontend/src/app/opengraph-image.tsx`, which Next adds by file convention to the root's fields alone.
 */
export const SITE_OPEN_GRAPH = { siteName: COPY.brand.name, locale: "de_DE", type: "website" } as const;

/**
 * A page's metadata from its row in `fl_frontend/src/core/routes.ts :: ROUTES` and its address: the title,
 * the description, the address as the preview's, and either the address as the canonical, on a page search
 * engines list, or `noindex`, on one they do not: a canonical names the address to list, which a page kept out
 * of the index has none of, so it declares none, as Yoast leaves it off a noindex page. A row titled by its record or its teams takes that title as `title`; a
 * listed page takes its description from `fl_frontend/src/core/serverCopy.ts :: SERVER_COPY.description`,
 * which holds one for a listed row alone. Call it from `generateMetadata`, handing on the `parent` Next
 * passes there.
 */
export function pageMetadata(
  parent: ResolvingMetadata,
  row: RouteEntry & { readonly title: Copy },
  path: string,
  words?: { readonly description?: Copy },
): Promise<Metadata>;
export function pageMetadata(
  parent: ResolvingMetadata,
  row: RouteEntry,
  path: string,
  words: { readonly title: Words; readonly description?: Copy },
): Promise<Metadata>;
export async function pageMetadata(
  parent: ResolvingMetadata,
  row: RouteEntry,
  path: string,
  words: { readonly title?: Words; readonly description?: Copy } = {},
): Promise<Metadata> {
  return {
    title: words.title === undefined ? (typeof row.title === "string" ? row.title : undefined) : textOf(words.title),
    description: words.description,
    openGraph: await openGraphFor(parent, path),
    ...(row.crawl === "index" ? { alternates: { canonical: path } } : { robots: { index: false, follow: false } }),
  };
}

/**
 * A page's preview fields, its address among them as og:url, which Meta's scraper takes as the shared object's
 * identity. Next replaces the parent's whole `openGraph` once a page declares one, image included, so the image
 * the root's file convention set is carried over from `parent`.
 */
export async function openGraphFor(parent: ResolvingMetadata, path: string): Promise<NonNullable<Metadata["openGraph"]>> {
  return { ...SITE_OPEN_GRAPH, url: path, images: (await parent).openGraph?.images };
}
