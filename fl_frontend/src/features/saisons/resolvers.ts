import { notFound, redirect } from "next/navigation";

import z from "zod";

import { SAISON_ID_LENGTH } from "./constants";
import { getAdminSaisons, getSaisons } from "./queries";
import { searchWithoutSaisonId } from "./utils";

import type { NextPageProps } from "@/shared/types/types";
import type { FLSaisonStatus } from "./schemas";

const saisonIdSchema = z.string().trim().length(SAISON_ID_LENGTH).optional().catch(undefined);

/**
 * The season named in the URL, or `undefined` so the backend applies its default — one round-trip
 * rather than the two a `getCurrentSaison()` prefetch costs. **An admin page must pass `"admin"`.**
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

/**
 * An absent id is the running season and fetches nothing. An admin page reads the public list too: a finished season
 * stands in it, and a planned one is unfinished either way.
 */
export async function resolveIsFinishedSaison(resolvedSaisonId: string | undefined): Promise<boolean> {
  if (resolvedSaisonId === undefined) return false;

  const { saisons } = await getSaisons();
  return saisons.some((saison) => saison.id === resolvedSaisonId && saison.status === "past");
}

/**
 * Which season a page addresses: the one asked for, else the running one. It returns rather than
 * redirecting or raising, so the page's own `notFound()` stays where a reader of the page meets it.
 */
export function selectSaison<T extends { id: string; status: FLSaisonStatus }>(
  saisons: readonly T[],
  requestedSaisonId: string | undefined,
): T | undefined {
  return saisons.find((saison) => (requestedSaisonId === undefined ? saison.status === "active" : saison.id === requestedSaisonId));
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
