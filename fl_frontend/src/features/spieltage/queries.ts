import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";

import { FLSpieltageListResponseSchema, FLSpieltageSingleResponseSchema } from "./schemas";

import type { FLSpieltageListResponse, FLSpieltageSingleResponse } from "./schemas";
import type { FLSpieltageFilterParams } from "./types";

export async function getSpieltage(filters: FLSpieltageFilterParams = {}): Promise<FLSpieltageListResponse> {
  "use cache";

  // Base tag only: one matchday write moves both the season-scoped admin list and the public
  // Spielplan's default-season entry, so no granular tag describes it.
  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageListResponse>("/spieltage", FLSpieltageListResponseSchema, {
    params: filters,
  });
}

/**
 * **The 404 → null conversion stays INSIDE the cache scope**: a production build redacts an error
 * thrown out of one to a digest-only `Error`. `getSpiel` carries it in full. Public read under the
 * base key, so `"use cache"` is right.
 */
export async function getSpieltagById(spieltagId: string): Promise<FLSpieltageSingleResponse | null> {
  "use cache";

  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageSingleResponse>(`/spieltage/${spieltagId}`, FLSpieltageSingleResponseSchema).catch((error: unknown) => {
    if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
    throw error;
  });
}
