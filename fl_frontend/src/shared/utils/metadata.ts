import type { Metadata } from "next";

/**
 * SHARED · Open Graph builder
 *
 * `openGraphFor(path)` is how every route declares its social card. Call it with the same path the
 * route gives `alternates.canonical`.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **Never declare a bare `openGraph` object on a route.** Next inherits the parent's object whole
 *     when a child defines none and REPLACES it whole when a child does — there is no field-by-field
 *     merge. A route spelling out `openGraph: { url }` silently drops the image, site name, locale and
 *     type, and the card degrades to a bare link.
 *   • `og:url` is not optional. Meta lists `og:title`, `og:type`, `og:image` and `og:url` as the four
 *     required properties, and a missing one is enough for WhatsApp to render no preview image.
 *   • The path is relative; `metadataBase` in the root layout resolves it. Passing an absolute URL
 *     works but defeats the single definition of the origin.
 */
export function openGraphFor(path: string): NonNullable<Metadata["openGraph"]> {
  return {
    url: path,
    siteName: "Frankfurt-League",
    images: [{ url: "/icons/opengraph/opengraph.png", width: 1200, height: 630, alt: "FL-Preview" }],
    locale: "de_DE",
    type: "website",
  };
}
