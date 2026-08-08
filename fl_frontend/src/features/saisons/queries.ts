/**
 * SAISONS · cached reads
 *
 * Seasons are the most stable data in the system and are cached for days.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only, and here it is the only tag that could exist: a season is not season-scoped data,
 *     it IS the season, and `getSaisons` reads every one of them in a single call. A
 *     `saisons:saison_id:...` tag would name an entry nothing ever creates (ADR-0001).
 *   • The base tag IS invalidated — `actions.ts` in this slice clears it on every season write, and
 *     the rollover clears `spiele`, `spieltage` and `teams` with it, because an omitted `saison_id`
 *     means the current season (ADR-0002).
 *   • A hand edit made directly in MongoDB still goes around all of that and is served stale until the
 *     daily cacheLife expires or the container is recreated. There is no invalidation endpoint, by
 *     decision (ADR-0035).
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
