import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { FLSpielerListResponseSchema, FLSpielerMembershipsResponseSchema, FLSpielerNachnominierungResponseSchema } from "./schemas";

import type { FLSpielerListResponse, FLSpielerMembershipsResponse, FLSpielerNachnominierungResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only — the squad page reads the running season by naming none, so a season tag would miss
  // the entry a squad save most often has to clear.
  cacheTag("spieler");

  // The consent record is an input here (`READ-PUPIL-003`) and no `spieler` write touches it: a
  // writer of a pupil's consent that drops no tag leaves a withdrawn name published for days.
  // `docs/frontend/spec.md :: I14` decides which call drops it.
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
    cacheFill: { name: "getSpieler", args: filters },
  });
}

/**
 * `getSpieler` cannot serve the admin surfaces at any filter setting — backend spec I33 carries the
 * reasons.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller
// (`docs/frontend/spec.md` §1.2).
export const getSpielerMemberships = cache(async (): Promise<FLSpielerMembershipsResponse> =>
  runWithIncomingTrace(() =>
    apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" }),
  ),
);

/** Whether the squad create would mark an entry into this season a Nachnominierung today. */
// Never `"use cache"`, for `getSpielerMemberships`' reason, and because the answer turns over at midnight.
export const getSpielerNachnominierung = cache(async (saisonId: string): Promise<FLSpielerNachnominierungResponse> =>
  runWithIncomingTrace(() =>
    apiClient<FLSpielerNachnominierungResponse>(`/spieler/nachnominierung/${saisonId}`, FLSpielerNachnominierungResponseSchema, {
      authType: "admin",
    }),
  ),
);
