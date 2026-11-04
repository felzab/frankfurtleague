import { notFound, redirect } from "next/navigation";

import z from "zod";

import { SEARCH_QUERY_PARAM } from "@/shared/utils/searchQuery";

import { SAISON_ID_LENGTH } from "./constants";
import { getAdminSaisons, getSaisonFrame } from "./queries";
import { searchWithoutSaisonId } from "./utils";

import type { FLSaisonAdmin, FLSaisonStatus } from "@/core/generated/client/types";
import type { NextPageProps } from "@/shared/types/types";

// Untrimmed: `SaisonSelector` matches the raw parameter, so a padded id it cannot find is malformed
// here too, and stripped rather than shown on the page alone.
const saisonIdSchema = z.string().length(SAISON_ID_LENGTH).optional().catch(undefined);

/**
 * The admin page's season named in the URL, or `undefined` so the caller applies its default — no read at all
 * where the URL names none.
 */
export async function resolveSaisonId(searchParamsPromise: NextPageProps["searchParams"]): Promise<string | undefined> {
  const searchParams = await searchParamsPromise;
  const requested = saisonIdSchema.parse(searchParams.saison_id);

  // Absent and malformed both parse to `undefined`; only the raw key separates them, and only the
  // malformed one has something to strip.
  if (requested === undefined && searchParams.saison_id === undefined) return undefined;

  if (requested !== undefined) {
    // The admin list, a planned season among it: an administrator picks one to enter clubs into it.
    const { saisons } = await getAdminSaisons();
    if (saisons.some((saison) => saison.id === requested)) return requested;
  }

  // Redirecting without the unknown value, rather than ignoring it, is what keeps this and
  // `SaisonSelector` from disagreeing.
  const { [SEARCH_QUERY_PARAM]: _suche, ...uebrige } = searchParams;
  redirect(searchWithoutSaisonId(uebrige));
}

/**
 * An admin page's season and the admin header's default (`SaisonMetadataDisplay`), so the two never
 * differ. It returns rather than redirecting, so each page's own answer to `undefined` stays where a
 * reader of that page meets it.
 */
export function selectSaison<T extends { id: string; status: FLSaisonStatus }>(
  saisons: readonly T[],
  requestedSaisonId: string | undefined,
): T | undefined {
  if (requestedSaisonId !== undefined) return saisons.find((saison) => saison.id === requestedSaisonId);

  return saisons.find((saison) => saison.status === "active") ?? saisons[0];
}

/** Every admin page's season; `undefined` only for a league holding none. */
export async function resolveAdminSaison(searchParamsPromise: NextPageProps["searchParams"]): Promise<FLSaisonAdmin | undefined> {
  const requestedSaisonId = await resolveSaisonId(searchParamsPromise);
  // The list even where the URL names no season: the running season alone leaves a league before its
  // first activation with nothing to show.
  const { saisons } = await getAdminSaisons();

  return selectSaison(saisons, requestedSaisonId);
}

/** For a page whose reads name a season: a league holding none is sent to the page that creates one. */
export async function requireAdminSaison(searchParamsPromise: NextPageProps["searchParams"]): Promise<FLSaisonAdmin> {
  return (await resolveAdminSaison(searchParamsPromise)) ?? redirect("/area/admin/saisons");
}

/**
 * A `[saison_id]` SEGMENT, or not-found. A segment names the page's subject, so unlike the search
 * parameter above there is no fallback: degrading would silently edit a season nobody asked for.
 */
export async function resolveSaisonIdParam(paramsPromise: NextPageProps<{ saison_id: string }>["params"]): Promise<string> {
  const parsed = z
    .string()
    .length(SAISON_ID_LENGTH)
    .safeParse((await paramsPromise).saison_id);
  if (!parsed.success) notFound();

  return parsed.data;
}

/**
 * A public season page's `[saison]` segment: a season the public may read, or not-found. Judged against the
 * frame's list, which filters on the same withheld status as every season read
 * (`fl_backend/app/api/saisons/visibility.py :: resolve_public_saison`), so a page's metadata carries the
 * not-found title for an unknown, malformed or withheld season, and no such segment reaches the backend or keys a
 * cache entry of its own: the frame is one read, which the season layout already makes.
 */
export async function resolvePublicSaisonParam(paramsPromise: Promise<{ saison: string }>): Promise<string> {
  const { saison } = await paramsPromise;
  const { saisons } = await getSaisonFrame();
  if (!saisons.some((entry) => entry.id === saison)) notFound();

  return saison;
}
