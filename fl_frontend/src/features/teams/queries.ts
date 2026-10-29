import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { isRecordMissing } from "@/core/errors";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import { FLTeamsMembershipsResponseSchema, FLTeamsResponseSchema, FLTeamsSingleResponseSchema } from "./schemas";

import type { FLTeamsMembershipsResponse, FLTeamsResponse, FLTeamsSingleResponse } from "./schemas";
import type { FLPublicTeamsFilterParams, FLTeamsFilterParams, FLTeamSingleFilterParams } from "./types";

export async function getTeams(filters: FLPublicTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return apiClient<FLTeamsResponse>("/teams", FLTeamsResponseSchema, {
    params: filters,
    cacheFill: { name: "getTeams", args: filters },
  });
}

/**
 * `null` on a 404, and **the conversion must stay INSIDE this function**: an error thrown out of a
 * `"use cache"` scope reaches the caller redacted to a digest, so a catch at the call site cannot
 * recognise it. Other errors still throw.
 */
export async function getTeam(teamId: string, filters: FLTeamSingleFilterParams = {}): Promise<FLTeamsSingleResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return apiClient<FLTeamsSingleResponse>(`/teams/${teamId}`, FLTeamsSingleResponseSchema, {
    params: filters,
    cacheFill: { name: "getTeam", args: { teamId: teamId, filters: filters } },
  }).catch((error: unknown) => {
    // A 404 is "no such team" OR "no junction row for this season": the join is strict.
    if (isRecordMissing(error)) return null;
    throw error;
  });
}

/** One in-flight admin club read per filter set, held for the length of one render pass. */
const adminTeamsInFlight = cache((): Map<string, Promise<FLTeamsResponse>> => new Map());

/**
 * A season's clubs for the admin surfaces, a planned season's included — `getTeams` refuses that
 * season, though a club is entered into one while planned. **Uncached**.
 */
export function getAdminTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminTeamsInFlight().get(key);
  if (held !== undefined) return held;

  const started = runAdminRead(() =>
    apiClient<FLTeamsResponse>("/teams/list/admin", FLTeamsResponseSchema, { authType: "admin", params: filters }),
  );
  adminTeamsInFlight().set(key, started);

  return started;
}

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export const getTeamMemberships = cache(async (): Promise<FLTeamsMembershipsResponse> =>
  runAdminRead(() => apiClient<FLTeamsMembershipsResponse>("/teams/memberships", FLTeamsMembershipsResponseSchema, { authType: "admin" })),
);
