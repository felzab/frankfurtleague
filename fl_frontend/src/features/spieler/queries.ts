import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpielerListResponseSchema } from "./schemas";

import type { FLSpielerListResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  const tags: string[] = ["spieler"];
  if (filters.team_id) tags.push(`spieler:team_id:${filters.team_id}`);
  if (filters.stufe) tags.push(`spieler:stufe:${filters.stufe}`);
  if (filters.saison_id) tags.push(`spieler:saison_id:${filters.saison_id}`);

  // Check '!== undefined' because 'false' is a valid filter value
  if (filters.is_nachgetragen !== undefined) tags.push(`teams:is_nachgetragen:${filters.is_nachgetragen}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
  });
}
