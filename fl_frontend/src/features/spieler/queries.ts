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
// Never `"use cache"` here, which keys on the arguments rather than the caller
// (`docs/frontend/spec.md` §1.2).
export const getSpielerMemberships = cache(async (): Promise<FLSpielerMembershipsResponse> =>
  runWithIncomingCorrelationId(() =>
    apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" }),
  ),
);
