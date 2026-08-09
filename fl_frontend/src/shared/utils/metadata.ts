/**
 * SHARED · Open Graph builder
 *
 * `openGraphFor(path)` is how every route declares its social card. Call it with the same path the
 * route gives `alternates.canonical`.
 *
 * Invariants:
 * - No route declares a bare `openGraph` object: Next inherits the parent's object whole when a
 *   child defines none and replaces it whole when a child does — there is no field-by-field merge,
 *   so `openGraph: { url }` silently drops the image, site name, locale and type.
 * - `og:url` stays present — Meta lists `og:title`, `og:type`, `og:image` and `og:url` as the four
 *   required properties, and a missing one is enough for WhatsApp to render no preview image.
 * - The path stays relative; `metadataBase` in the root layout resolves it — an absolute URL works
 *   but defeats the single definition of the origin.
 */

import type { Metadata } from "next";

export function openGraphFor(path: string): NonNullable<Metadata["openGraph"]> {
  return {
    url: path,
    siteName: "Frankfurt-League",
    images: [{ url: "/icons/opengraph/opengraph.png", width: 1200, height: 630, alt: "FL-Preview" }],
    locale: "de_DE",
    type: "website",
  };
}
