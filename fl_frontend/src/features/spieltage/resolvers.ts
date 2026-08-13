/**
 * SPIELTAGE · route-parameter resolution
 *
 * Bridges a dynamic route segment to a validated matchday id. Out of `queries.ts` so a non-caching
 * function stays out of a `"use cache"` module (ADR-0003).
 *
 * Invariants:
 * - Parse, never cast — an unvalidated segment is a backend request and a cache entry per variant.
 * - A bad matchday id ends the render; unlike a season, there is no sensible fallback matchday.
 */

import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[spieltag_id]` route segment, or renders not-found.
 *
 * Parse, not cast — `resolveTeamId` documents the reasoning in full and it is identical here.
 */
export async function resolveSpieltagId(paramsPromise: NextPageProps<{ spieltag_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).spieltag_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
