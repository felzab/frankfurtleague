/**
 * SAISONS · route-parameter resolution
 *
 * Bridges `?saison_id=` to a value the query layer can pass through, and a `[saison_id]` segment
 * to the season an editor addresses. Kept out of `queries.ts` because it is not caching code.
 *
 * Invariants:
 * - Returning `undefined` is the point: the backend resolves an absent season to the current one.
 * - An absent parameter reads no season list — the hot path stays free of a pre-query (ADR-0055).
 * - A parameter naming no real season is stripped from the URL and the render restarts (ADR-0055).
 * - `apiClient` drops `undefined` params, which lets callers pass the result straight through.
 */

import { notFound, redirect } from "next/navigation";

import z from "zod";

import { getSaisons } from "./queries";
import { searchWithoutSaisonId } from "./utils";

import type { NextPageProps } from "@/shared/types/types";

const saisonIdSchema = z.string().trim().length(4).optional().catch(undefined);

/**
 * The season explicitly asked for in the URL, or `undefined` to let the backend apply its default.
 *
 * `undefined` is the whole point, rather than a fallback to `getCurrentSaison()`, which
 * put a serialised round-trip in front of every page query on 8 routes: the page could not issue its
 * real request until the season lookup came back. ADR-0002 moved that default into FastAPI, so omitting
 * the parameter now means "the current season" there — one round-trip instead of two.
 *
 * `apiClient` drops `undefined` params rather than serialising them, so callers pass the result
 * straight through and no call site changes shape.
 *
 * **A value naming no real season ends the render and rewrites the URL without it** (ADR-0055).
 * `SaisonSelector` already validates `?saison_id=` against the same list and falls back to the current
 * season, so a value only this side accepted left the sidemenu naming one season while the page below
 * queried another and rendered every row as empty. Validating here rather than in each page is what
 * makes the two agree on all sixteen season-scoped routes at once.
 *
 * The read that backs it is the one the sidemenu issues on every one of those routes — `getSaisons` is
 * `"use cache"`, so the check costs a cache hit, and only on a request that carries the parameter at
 * all. ADR-0002's measured cost was on the ABSENT path, which still returns before reaching this.
 */
export async function resolveSaisonId(searchParamsPromise: NextPageProps["searchParams"]): Promise<string | undefined> {
  const searchParams = (await searchParamsPromise) ?? {};
  const requested = saisonIdSchema.parse(searchParams.saison_id);

  // No parameter, no lookup: the backend's default applies and this is the path most loads take.
  // Distinguished from a MALFORMED parameter by the raw key, because the schema maps both to
  // `undefined` and only one of them has something to strip.
  if (requested === undefined && searchParams.saison_id === undefined) return undefined;

  if (requested !== undefined) {
    const { saisons } = await getSaisons();
    if (saisons.some((saison) => saison.id === requested)) return requested;
  }

  redirect(searchWithoutSaisonId(searchParams));
}

/**
 * Parses a `[saison_id]` route SEGMENT, or renders not-found.
 *
 * The opposite disposition from the function above, and for the reason `resolveSpielerId` documents: a
 * search parameter names a preference the backend has a default for, while a segment names the subject
 * of the page. There is no sensible fallback season for an editor addressed by a season that does not
 * parse, and degrading to the current one would silently edit a season nobody asked for.
 */
export async function resolveSaisonIdParam(paramsPromise: NextPageProps<{ saison_id: string }>["params"]): Promise<string> {
  const parsed = z
    .string()
    .length(4)
    .safeParse((await paramsPromise).saison_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
