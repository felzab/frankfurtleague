/**
 * SPIELE · cached reads
 *
 * The list read and the single read, both tagged and both invalidated by `actions.ts` in this same
 * slice, which is the pairing that keeps invalidation honest.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every granular tag declared here has a matching `updateTag` in `actions.ts`. A tag nothing
 *     invalidates is not a caching strategy — it is decoration that reads like coverage.
 *   • Omitting `saison_id` means the current season, not all seasons. The backend resolves it, so the
 *     most common cache entries carry only the base tag.
 *   • The single read declares the base tag ONLY. A match write resolves the whole season's bracket and
 *     rewrites fixtures the request never named (ADR-0042), so no narrower tag describes it.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 4, the full cache-tag design
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";

import { FLSpieleListResponseSchema, FLSpieleSingleResponseSchema } from "./schemas";

import type { FLSpieleListResponse, FLSpieleSingleResponse } from "./schemas";
import type { FLSpieleFilterParams } from "./types";

export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  "use cache";

  // The only granular tag kept for this resource (ADR-0001): the admin patch action invalidates it
  // by season. No tags by phase or status: a result edit *changes* a match's status, so invalidating
  // by status would need both the previous and the new value to be correct.
  const tags: string[] = ["spiele"];
  if (filters.saison_id) tags.push(`spiele:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("hours");

  return apiClient("/spiele", FLSpieleListResponseSchema, {
    params: filters,
  });
}

/**
 * One match by its id, for the edit page whose subject IS that match (ADR-0050).
 *
 * **The base tag alone, and that is not an oversight.** A season-scoped tag would need the season, which
 * is what this response exists to supply — and it would be wrong even if it were available: the patch
 * that resolves a bracket rewrites *other* fixtures of the same season (ADR-0042), so nothing narrower
 * than `spiele` describes what one match write invalidates. The action invalidates `spiele`
 * unconditionally on every match write, so this entry can never outlive an edit (ADR-0001).
 *
 * **Resolves `null` when the id matches no match, and the 404 → null conversion must stay INSIDE this
 * function.** In a production build, an error thrown out of a `"use cache"` scope reaches the awaiting
 * caller redacted to a digest-only `Error` — `instanceof` and `statusCode` are gone — so a catch at
 * the call site can never recognise the 404 and the edit page rendered the error page for an unknown
 * id. Only the 404 becomes a value; everything else still throws, so a backend outage never reads as
 * a missing fixture.
 */
export async function getSpiel(spielId: string): Promise<FLSpieleSingleResponse | null> {
  "use cache";

  cacheTag("spiele");
  cacheLife("hours");

  return apiClient(`/spiele/${spielId}`, FLSpieleSingleResponseSchema).catch((error: unknown) => {
    if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
    throw error;
  });
}
