/**
 * SPIELER · route-parameter resolution
 *
 * Bridges a dynamic route segment to a validated player id. Kept out of `queries.ts` because it is
 * not caching code, and folding it in would put a non-caching function inside a `"use cache"` module.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • PARSE, do not cast. The type says `string`, but nothing checks what is actually in the URL, and
 *     the value is forwarded to the backend. An unvalidated segment becomes a backend request plus a
 *     distinct cache entry per variant — an unbounded cache-fill vector.
 *   • A bad player id ends the render. Unlike a season, there is no sensible fallback player.
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
