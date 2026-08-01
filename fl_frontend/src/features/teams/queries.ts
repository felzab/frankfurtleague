import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLTeamsResponseSchema } from "./schemas";

import type { FLTeamsResponse } from "./schemas";
import type { FLTeamsFilterParams } from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // The only granular tag kept for this resource (audit D2): patch_spiel_data calls
  // update_team_statistik, so a result change rewrites team stats within that season only. The
  // gruppe / include_placeholders / is_disqualified / in_gruppen tags were deleted -- no mutation
  // in the app changes any of those dimensions.
  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsResponse>("/teams", FLTeamsResponseSchema, {
    params: filters,
  });
}
