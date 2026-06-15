import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { FLSaisonsFilterParams, FLSaisonsListResponse, FLSaisonsSingleResponse } from "./types";

export async function getSaisons(filters: FLSaisonsFilterParams = {}): Promise<FLSaisonsListResponse> {
  "use cache";

  const tags: string[] = ["saisons"];
  if (filters.saison_id) tags.push(`saisons:saison_id:${filters.saison_id}`);
  if (filters.status) tags.push(`saisons:status:${filters.status}`);

  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSaisonsListResponse>("/saisons", {
    params: filters as Record<string, string | number | boolean>,
  });
}

export async function getCurrentSeason(): Promise<FLSaisonsSingleResponse> {
  "use cache";

  cacheTag("saisons", "saisons:current");
  cacheLife("days");

  return apiClient<FLSaisonsSingleResponse>("/saisons/current");
}
