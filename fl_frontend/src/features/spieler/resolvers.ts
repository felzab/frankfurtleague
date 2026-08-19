/**
 * SPIELER · route-parameter resolution
 *
 * Bridges a dynamic route segment to a validated player id. Out of `queries.ts` so a non-caching
 * function stays out of a `"use cache"` module.
 *
 * Invariants:
 * - Parse, never cast — an unvalidated segment is a backend request and a cache entry per variant.
 * - A bad player id ends the render; unlike a season, there is no sensible fallback player.
 */

import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[spieler_id]` route segment, or renders not-found.
 *
 * Parse, not cast — `resolveTeamId` documents the reasoning in full and it is identical here.
 */
export async function resolveSpielerId(paramsPromise: NextPageProps<{ spieler_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).spieler_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
