/**
 * TEAMS · route-parameter resolution
 *
 * Bridges a dynamic route segment to a validated team id. Out of `queries.ts` so a non-caching
 * function stays out of a `"use cache"` module.
 *
 * Invariants:
 * - Parse, never cast — an unvalidated segment is a backend request and a cache entry per variant.
 * - A bad team id ends the render; unlike a season, there is no sensible fallback team.
 */

import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[team_id]` route segment, or renders not-found.
 *
 * Parse, not cast. `NextPageProps<{ team_id: string }>` already makes the value a `string` at the
 * type level, but nothing checks what is actually in the URL, and the value is forwarded to the
 * backend under the base API key. An arbitrarily long segment would otherwise become a backend
 * request plus a distinct `use cache` entry per variant.
 *
 * Unlike `resolveSaisonId`, a bad value cannot degrade to a default — there is no sensible fallback
 * team — so this ends the render instead.
 */
export async function resolveTeamId(paramsPromise: NextPageProps<{ team_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).team_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
