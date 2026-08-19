import type { Metadata } from "next";

/**
 * Call it with the path the route gives `alternates.canonical`. **No route declares a bare `openGraph` object**:
 * Next replaces the parent's whole when a child defines one, so `openGraph: { url }` silently drops the image.
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
