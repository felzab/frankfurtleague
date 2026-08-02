/**
 * SAISONS · route-parameter resolution
 *
 * Bridges `?saison_id=` to a value the query layer can pass through. Used by nine page components.
 * Kept out of `queries.ts` because it is not caching code.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Returning `undefined` is the point, not a fallback. The backend resolves an absent season to the
 *     current one, so passing nothing costs one round trip where looking the season up first cost two.
 *   • A malformed value degrades to `undefined` rather than throwing — same observable behaviour, since
 *     the backend then applies the same default.
 *   • `apiClient` drops `undefined` params rather than serialising them, which is what lets callers
 *     pass the result straight through without branching.
 */

import z from "zod";

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
 * A malformed value still degrades to `undefined` rather than throwing, which now means "current
 * season" instead of "the season the frontend looked up" — same observable behaviour.
 */
export async function resolveSaisonId(searchParamsPromise: NextPageProps["searchParams"]): Promise<string | undefined> {
  return saisonIdSchema.parse((await searchParamsPromise)?.saison_id);
}
