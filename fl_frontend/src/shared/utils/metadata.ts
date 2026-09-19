import { withSaisonId } from "./saisonHref";

import type { Metadata } from "next";

/**
 * `saisonId` is `resolveSaisonId`'s answer, never the raw parameter (`docs/frontend/spec.md` §1.13).
 *
 * **A URL naming the RUNNING season canonicalises to the bare address**, which serves that same
 * page: two self-canonicalising addresses split one page's indexing.
 */
export function seasonScopedMetadata(
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
