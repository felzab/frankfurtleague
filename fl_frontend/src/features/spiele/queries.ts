/**
 * SPIELE · cached read
 *
 * The slice's only cached read. Its tags are invalidated by `actions.ts` in this same slice, which is
 * the pairing that keeps invalidation honest.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Every granular tag declared here has a matching `updateTag` in `actions.ts`. A tag nothing
 *     invalidates is not a caching strategy — it is decoration that reads like coverage.
 *   • Omitting `saison_id` means the current season, not all seasons. The backend resolves it, so the
 *     most common cache entries carry only the base tag.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 4, the full cache-tag design
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpieleListResponseSchema } from "./schemas";

import type { FLSpieleListResponse } from "./schemas";
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
