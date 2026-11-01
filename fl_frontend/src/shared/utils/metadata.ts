import type { Copy } from "@/core/copy";
import type { RouteEntry } from "@/core/routes";
import type { Metadata } from "next";

/**
 * A page's metadata from its row in `fl_frontend/src/core/routes.ts :: ROUTES` and its address: the
 * title, the address as the canonical and the preview's, and `noindex` where the row says search
 * engines may not list the page. A page declaring none inherits the root layout's, whose canonical is
 * the homepage. A row titled by its record or its teams takes that title as `title`.
 */
export function pageMetadata(row: RouteEntry & { readonly title: Copy }, path: string): Metadata;
export function pageMetadata(row: RouteEntry, path: string, title: string): Metadata;
export function pageMetadata(row: RouteEntry, path: string, title?: string): Metadata {
  return {
    title: title ?? (typeof row.title === "string" ? row.title : undefined),
    alternates: { canonical: path },
    openGraph: openGraphFor(path),
    ...(row.indexed ? {} : { robots: { index: false, follow: false } }),
  };
}

/**
 * Call it with the path the route gives `alternates.canonical`. **No route declares a bare `openGraph` object**:
 * Next replaces the parent's whole when a child defines one, so `openGraph: { url }` silently drops the image.
 */
export function openGraphFor(path: string): NonNullable<Metadata["openGraph"]> {
  return {
    url: path,
    siteName: "Frankfurt League",
    images: [
      {
        url: "/icons/opengraph/opengraph.png",
        width: 1200,
        height: 630,
        alt: "Frankfurt League, die Oberstufenliga: Schriftzug neben dem Pokal",
      },
    ],
    locale: "de_DE",
    type: "website",
  };
}
