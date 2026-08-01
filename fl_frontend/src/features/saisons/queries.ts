/**
 * SAISONS · cached reads
 *
 * Seasons are the most stable data in the system and are cached for days.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only. `saisons` has no frontend write surface, so a granular tag could never be
 *     invalidated by anything — it would read as coverage and provide none.
 *   • Because nothing in the app writes seasons, a direct database edit is served stale until the tag
 *     is cleared out of band. That is what `POST /api/revalidate` exists for.
 *   • `getCurrentSaison` takes no filters on purpose: "current" is a backend determination, and a
 *     second definition here would be one that could disagree.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 5, out-of-band invalidation
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSaisonsListResponseSchema, FLSaisonsSingleResponseSchema } from "./schemas";

import type { FLSaisonsListResponse, FLSaisonsSingleResponse } from "./schemas";
import type { FLSaisonsFilterParams } from "./types";

export async function getSaisons(filters: FLSaisonsFilterParams = {}): Promise<FLSaisonsListResponse> {
  "use cache";

  // Base tag only: `saisons` has no frontend write surface, so nothing could invalidate a granular one.
  cacheTag("saisons");
  cacheLife("days");

  return apiClient<FLSaisonsListResponse>("/saisons", FLSaisonsListResponseSchema, {
    params: filters,
  });
}

export async function getCurrentSaison(): Promise<FLSaisonsSingleResponse> {
  "use cache";

  cacheTag("saisons");
  cacheLife("days");

  return apiClient<FLSaisonsSingleResponse>("/saisons/current", FLSaisonsSingleResponseSchema);
}
