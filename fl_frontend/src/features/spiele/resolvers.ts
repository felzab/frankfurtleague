/**
 * SPIELE · route-parameter resolution
 *
 * Bridges the edit page's dynamic segment to a validated match id. Kept out of `queries.ts` because it
 * is not caching code, and folding it in would put a non-caching function inside a `"use cache"` module
 * (ADR-0003).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • PARSE, do not cast. The type says `string`, but nothing checks what is actually in the URL, and
 *     the value is forwarded to the backend under the base API key. An unvalidated segment becomes a
 *     backend request plus a distinct cache entry per variant — an unbounded cache-fill vector.
 *   • A bad match id ends the render. There is no sensible fallback fixture to edit.
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
