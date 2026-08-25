import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpielerListResponseSchema, FLSpielerMembershipsResponseSchema } from "./schemas";

import type { FLSpielerListResponse, FLSpielerMembershipsResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only — this read spans every season, so no granular tag could name a save.
  cacheTag("spieler");
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
  });
}

/**
 * `getSpieler` cannot serve the admin surfaces at any filter setting — backend spec I33 carries the
 * reasons.
 */
// React's `cache` memoizes per RENDER PASS, never across requests -- unlike `"use cache"`, whose
// key is the arguments, not the caller, so an admin read there becomes a slot of authorized data
// any caller reaches. One pass, one round trip.
export const getSpielerMemberships = cache(async (): Promise<FLSpielerMembershipsResponse> =>
  runWithIncomingCorrelationId(() =>
    apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" }),
  ),
);
