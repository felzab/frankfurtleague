import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpieleListResponseSchema } from "./schemas";

import type { FLSpieleListResponse } from "./schemas";
import type { FLSpieleFilterParams } from "./types";

export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  "use cache";

  const tags: string[] = ["spiele"];
  if (filters.saison_phase) tags.push(`spiele:phase:${filters.saison_phase}`);
  if (filters.spiel_status) tags.push(`spiele:status:${filters.spiel_status}`);
  if (filters.saison_id) tags.push(`spiele:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("hours");

  return apiClient("/spiele", FLSpieleListResponseSchema, {
    params: filters,
  });
}
