/**
 * SPIELE · route-parameter resolution
 *
 * Bridges the edit page's dynamic segment to a validated match id. Out of `queries.ts` so a
 * non-caching function stays out of a `"use cache"` module (ADR-0003).
 *
 * Invariants:
 * - Parse, never cast — an unvalidated segment is a backend request and a cache entry per variant.
 * - A bad match id ends the render; there is no sensible fallback fixture to edit.
 */

import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[spiel_id]` route segment, or renders not-found.
 *
 * The same parse-not-cast rule `resolveTeamId` states: the segment reaches the backend under the base
 * API key, so an arbitrarily long value would become a request plus its own `use cache` entry.
 */
export async function resolveSpielId(paramsPromise: NextPageProps<{ spiel_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).spiel_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
