import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLTeamsResponseSchema } from "./schemas";

import type { FLTeamsResponse } from "./schemas";
import type { FLTeamsFilterParams } from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  if (filters.gruppe) tags.push(`teams:gruppe:${filters.gruppe}`);

  // Check '!== undefined' because 'false' is a valid filter value
  if (filters.include_placeholders !== undefined) tags.push(`teams:include_placeholders:${filters.include_placeholders}`);
  if (filters.is_disqualified !== undefined) tags.push(`teams:is_disqualified:${filters.is_disqualified}`);
  if (filters.in_gruppen !== undefined) tags.push(`teams:in_gruppen:${filters.in_gruppen}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsResponse>("/teams", FLTeamsResponseSchema, {
    params: filters as Record<string, string | number | boolean>,
  });
}
