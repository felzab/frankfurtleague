import { notFound } from "next/navigation";

import { getSaisonFrame } from "./queries";

import type { FLSaisonStatus } from "@/core/generated/client/types";

/**
 * The season the admin frame opens on: the running one, else the list's first, `undefined` only for a league
 * holding none.
 */
export function selectSaison<T extends { id: string; status: FLSaisonStatus }>(saisons: readonly T[]): T | undefined {
  return saisons.find((saison) => saison.status === "active") ?? saisons[0];
}

/**
 * A public season page's `[saison]` segment: a season the public may read, or `null`. Judged against the frame's list,
 * which filters on the same withheld status as every season read
 * (`fl_backend/app/api/saisons/visibility.py :: resolve_public_saison`), so a page's metadata carries the not-found
 * title for an unknown, malformed or withheld season (`fl_frontend/src/shared/utils/notFoundMetadata.ts ::
 * metadataFor`), and no such segment reaches the backend or keys a cache entry of its own: the frame is one read,
 * which the season layout already makes.
 */
export async function publicSaisonOf(paramsPromise: Promise<{ saison: string }>): Promise<string | null> {
  const { saison } = await paramsPromise;
  const { saisons } = await getSaisonFrame();
  return saisons.some((entry) => entry.id === saison) ? saison : null;
}

/** A public season page's `[saison]` segment, or not-found, for the page's body. */
export async function resolvePublicSaisonParam(paramsPromise: Promise<{ saison: string }>): Promise<string> {
  const saison = await publicSaisonOf(paramsPromise);
  if (saison === null) notFound();

  return saison;
}
