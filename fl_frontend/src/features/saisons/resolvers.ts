import z from "zod";

import type { NextPageProps } from "@/shared/types/types";

const saisonIdSchema = z.string().trim().length(4).optional().catch(undefined);

/**
 * The season explicitly asked for in the URL, or `undefined` to let the backend apply its default.
 *
 * `undefined` is the whole point (R4 §15.1). This used to fall back to `getCurrentSaison()`, which
 * put a serialised round-trip in front of every page query on 8 routes: the page could not issue its
 * real request until the season lookup came back. BE-1 moved that default into FastAPI, so omitting
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
