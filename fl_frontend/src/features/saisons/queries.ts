import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

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

/**
 * Every season, the planned ones `getSaisons` withholds included. A club is entered into a season
 * only while it is still planned, so an admin surface that cannot see one cannot run the league.
 */
// React's `cache` memoizes per RENDER PASS, so one pass makes one round trip. Never `"use cache"`
// here, which keys on the arguments rather than the caller (`docs/frontend/spec.md` §1.2).
export const getAdminSaisons = cache(async (): Promise<FLSaisonsListResponse> =>
  runWithIncomingCorrelationId(() =>
    apiClient<FLSaisonsListResponse>("/saisons/list/admin", FLSaisonsListResponseSchema, { authType: "admin" }),
  ),
);

export async function getCurrentSaison(): Promise<FLSaisonsSingleResponse> {
  "use cache";

  cacheTag("saisons");
  cacheLife("days");

  return apiClient<FLSaisonsSingleResponse>("/saisons/current", FLSaisonsSingleResponseSchema);
}
