import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import {
  FLKaderResponseSchema,
  FLSpielerListResponseSchema,
  FLSpielerMembershipsResponseSchema,
  FLSpielerNachnominierungResponseSchema,
  FLSpielerSelbstResponseSchema,
} from "./schemas";

import type {
  FLKaderResponse,
  FLSpielerListResponse,
  FLSpielerMembershipsResponse,
  FLSpielerNachnominierungResponse,
  FLSpielerSelbstResponse,
} from "./schemas";
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
  runAdminRead(() =>
    apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" }),
  ),
);

/** Whether the squad create would mark an entry into this season a Nachnominierung today. */
// Never `"use cache"`, for `getSpielerMemberships`' reason, and because the answer turns over at midnight.
export const getSpielerNachnominierung = cache(async (saisonId: string): Promise<FLSpielerNachnominierungResponse> =>
  runAdminRead(() =>
    apiClient<FLSpielerNachnominierungResponse>(`/spieler/nachnominierung/${saisonId}`, FLSpielerNachnominierungResponseSchema, {
      authType: "admin",
    }),
  ),
);

/**
 * One team's squad as its seat holder reads it, refused `REQ-FUNKTION-001` where the backend does not
 * find the seat the page's own check found.
 */
// Never `"use cache"`, for `getSpielerMemberships`' reason: what it answers is the reading person's.
export const getKader = cache(async (teamId: string, saisonId: string): Promise<FLKaderResponse> =>
  runPersonRead(() => apiClient<FLKaderResponse>(`/spieler/kader/${teamId}/${saisonId}`, FLKaderResponseSchema, { authType: "admin" })),
);

/**
 * The signed-in pupil's own record, refused `REQ-FUNKTION-001` where the backend holds no confirmed
 * pupil row for the address the page's own check passed.
 */
// Never `"use cache"`, for `getSpielerMemberships`' reason: what it answers is the reading person's.
export const getSpielerSelbst = cache(async (): Promise<FLSpielerSelbstResponse> =>
  runPersonRead(() => apiClient<FLSpielerSelbstResponse>("/spieler/selbst", FLSpielerSelbstResponseSchema, { authType: "admin" })),
);
