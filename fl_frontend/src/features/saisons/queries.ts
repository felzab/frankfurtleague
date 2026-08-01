import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSaisonsListResponseSchema, FLSaisonsSingleResponseSchema } from "./schemas";

import type { FLSaisonsListResponse, FLSaisonsSingleResponse } from "./schemas";
import type { FLSaisonsFilterParams } from "./types";

export async function getSaisons(filters: FLSaisonsFilterParams = {}): Promise<FLSaisonsListResponse> {
  "use cache";

  const tags: string[] = ["saisons"];
  if (filters.saison_id) tags.push(`saisons:saison_id:${filters.saison_id}`);
  if (filters.status) tags.push(`saisons:status:${filters.status}`);

  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSaisonsListResponse>("/saisons", FLSaisonsListResponseSchema, {
    params: filters,
  });
}

export async function getCurrentSaison(): Promise<FLSaisonsSingleResponse> {
  "use cache";

  cacheTag("saisons", "saisons:current");
  cacheLife("days");

  return apiClient<FLSaisonsSingleResponse>("/saisons/current", FLSaisonsSingleResponseSchema);
}
