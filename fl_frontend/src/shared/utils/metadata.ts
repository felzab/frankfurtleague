import { withSaisonId } from "./saisonHref";

import type { Copy } from "@/core/copy";
import type { RouteEntry } from "@/core/routes";
import type { Metadata } from "next";

/**
 * A page's metadata from its row in `fl_frontend/src/core/routes.ts :: ROUTES` and its address: the
 * title, the address as the canonical and the preview's, and `noindex` where the row says search
 * engines may not list the page. A page declaring none inherits the root layout's, whose canonical is
 * the homepage. A row titled by its record or its teams takes that title as `titel`.
 */
export function pageMetadata(row: RouteEntry & { readonly titel: Copy }, path: string): Metadata;
export function pageMetadata(row: RouteEntry, path: string, titel: string): Metadata;
export function pageMetadata(row: RouteEntry, path: string, titel?: string): Metadata {
  return {
    title: titel ?? (typeof row.titel === "string" ? row.titel : undefined),
    alternates: { canonical: path },
    openGraph: openGraphFor(path),
    ...(row.indexed ? {} : { robots: { index: false, follow: false } }),
  };
}

// Session 3: goes with the old dashboard pages, its last importers; `pageMetadata` stays.
/**
 * `saisonId` is `resolveSaisonId`'s answer, never the raw parameter.
 *
 * **A URL naming the RUNNING season canonicalises to the bare address**, which serves that same
 * page: two self-canonicalising addresses split one page's indexing.
 */
export function saisonScopedMetadata(
  path: string,
  saisonId: string | undefined,
  runningSaisonId: string | undefined,
): Pick<Metadata, "alternates" | "openGraph"> {
  const url = withSaisonId(path, saisonId === runningSaisonId ? undefined : saisonId);

  return { openGraph: openGraphFor(url), alternates: { canonical: url } };
}

/** The season a description names, from the same answer: a past season's page never calls itself the running one. */
export function saisonPhrase(saisonId: string | undefined): string {
  return saisonId === undefined ? "der laufenden Saison" : `der Saison ${saisonId}`;
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
