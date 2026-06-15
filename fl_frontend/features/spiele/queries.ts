import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { FLSpieleFilterParams, FLSpieleListResponse } from "./types";

export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  "use cache";

  const tags: string[] = ["spiele"];
  if (filters.saison_phase) tags.push(`spiele:phase:${filters.saison_phase}`);
  if (filters.spiel_status) tags.push(`spiele:status:${filters.spiel_status}`);
  if (filters.saison_id) tags.push(`spiele:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSpieleListResponse>("/spiele", {
    params: filters as Record<string, string | number | boolean>,
  });
}
