import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpielerListResponseSchema } from "./schemas";

import type { FLSpielerListResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only (audit D2): `spieler` has no frontend write surface, so no action can invalidate
  // a granular tag on it. Revisit only if a backend-triggered revalidation route arrives.
  cacheTag("spieler");
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
  });
}
