import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpieltageListResponseSchema } from "./schemas";

import type { FLSpieltageListResponse } from "./schemas";
import type { FLSpieltageFilterParams } from "./types";

export async function getSpieltage(filters: FLSpieltageFilterParams = {}): Promise<FLSpieltageListResponse> {
  "use cache";

  // Base tag only (audit D2): `spieltage` has no frontend write surface, so its granular tags could
  // never be invalidated. Per CLAUDE.md §6, granular tags belong on `spiele` and `teams` alone.
  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageListResponse>("/spieltage", FLSpieltageListResponseSchema, {
    params: filters,
  });
}
