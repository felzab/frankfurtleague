/**
 * SAISONS · cached reads
 *
 * Seasons are the most stable data in the system and are cached for days.
 *
 * Invariants:
 * - Base tag only, and the only tag possible: `getSaisons` reads every season in one call (ADR-0001).
 * - `actions.ts` clears it on every write; the rollover clears `spiele`, `spieltage`, `teams` too
 *   (ADR-0002).
 * - A Compass edit is served stale until the daily cacheLife expires — no invalidation endpoint (ADR-0028).
 * - `getCurrentSaison` takes no filters: "current" is a backend determination.
 *
 * See:
 * - docs/frontend/spec.md — section 1.5, out-of-band invalidation
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSaisonsListResponseSchema, FLSaisonsSingleResponseSchema } from "./schemas";

import type { FLSaisonsListResponse, FLSaisonsSingleResponse } from "./schemas";
import type { FLSaisonsFilterParams } from "./types";

export async function getSaisons(filters: FLSaisonsFilterParams = {}): Promise<FLSaisonsListResponse> {
  "use cache";

  // Base tag only: this read spans every season, so nothing narrower describes it.
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
