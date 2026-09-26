import { notFound, redirect } from "next/navigation";

import z from "zod";

import { SAISON_ID_LENGTH } from "./constants";
import { getAdminSaisons, getSaisons } from "./queries";
import { searchWithoutSaisonId } from "./utils";

import type { NextPageProps } from "@/shared/types/types";
import type { FLSaison, FLSaisonStatus } from "./schemas";

// Untrimmed: `SaisonSelector` matches the raw parameter, so a padded id it cannot find is malformed
// here too, and stripped rather than shown on the page alone.
const saisonIdSchema = z.string().length(SAISON_ID_LENGTH).optional().catch(undefined);

/**
 * The season named in the URL, or `undefined` so the backend applies its default — one round-trip
 * rather than the two a `getCurrentSaisonOrNull()` prefetch costs. **An admin page must pass `"admin"`.**
 */
export async function resolveSaisonId(
  searchParamsPromise: NextPageProps["searchParams"],
  tier: "base" | "admin" = "base",
): Promise<string | undefined> {
  const searchParams = await searchParamsPromise;
  const requested = saisonIdSchema.parse(searchParams.saison_id);

  // Absent and malformed both parse to `undefined`; only the raw key separates them, and only the
  // malformed one has something to strip.
  if (requested === undefined && searchParams.saison_id === undefined) return undefined;

  if (requested !== undefined) {
    // At `"base"` a planned season is unknown, so an admin picking one is redirected straight back
    // off it.
    const { saisons } = tier === "admin" ? await getAdminSaisons() : await getSaisons();
    if (saisons.some((saison) => saison.id === requested)) return requested;
  }

  // Redirecting without the unknown value, rather than ignoring it, is what keeps this and
  // `SaisonSelector` from disagreeing.
  redirect(searchWithoutSaisonId(searchParams));
}

/** An absent id is the running season and fetches nothing. */
export async function resolveIsFinishedSaison(resolvedSaisonId: string | undefined): Promise<boolean> {
  if (resolvedSaisonId === undefined) return false;

  const { saisons } = await getSaisons();
  return saisons.some((saison) => saison.id === resolvedSaisonId && saison.status === "past");
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

/** Every admin page's season (`docs/frontend/spec.md :: I359`); `undefined` only for a league holding none. */
export async function resolveAdminSaison(searchParamsPromise: NextPageProps["searchParams"]): Promise<FLSaison | undefined> {
  const requestedSaisonId = await resolveSaisonId(searchParamsPromise, "admin");
  // The list even where the URL names no season: the running season alone leaves a league before its
  // first activation with nothing to show.
  const { saisons } = await getAdminSaisons();

  return selectSaison(saisons, requestedSaisonId);
}

/** For a page whose reads name a season: a league holding none is sent to the page that creates one (`docs/frontend/spec.md :: I363`). */
export async function requireAdminSaison(searchParamsPromise: NextPageProps["searchParams"]): Promise<FLSaison> {
  // eslint-disable-next-line local/admin-link -- an empty league has no season to carry
  return (await resolveAdminSaison(searchParamsPromise)) ?? redirect("/admin/saisons");
}

/**
 * A `[saison_id]` SEGMENT, or not-found. A segment names the page's subject, so unlike the search
 * parameter above there is no fallback: degrading would silently edit a season nobody asked for.
 */
export async function resolveSaisonIdParam(paramsPromise: NextPageProps<{ saison_id: string }>["params"]): Promise<string> {
  const saisonId = await parseSaisonIdParam(paramsPromise);
  if (saisonId === null) notFound();

  return saisonId;
}

/** The same judgement without the throw, for `generateMetadata`, which answers a 404's title where a throw leaves the layout's. */
export async function parseSaisonIdParam(paramsPromise: NextPageProps<{ saison_id: string }>["params"]): Promise<string | null> {
  const parsed = z
    .string()
    .length(SAISON_ID_LENGTH)
    .safeParse((await paramsPromise).saison_id);

  return parsed.success ? parsed.data : null;
}
