import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLTeamsMembershipsResponseSchema, FLTeamsResponseSchema, FLTeamsSingleResponseSchema } from "./schemas";

import type { FLTeamsMembershipsResponse, FLTeamsResponse, FLTeamsSingleResponse } from "./schemas";
import type { FLTeamsFilterParams, FLTeamSingleFilterParams } from "./types";

/**
 * Statistics are derived from the match documents on every read, so a Spiel result edit moves this
 * response without touching a team document — which is why
 * `fl_frontend/src/features/spiele/actions.ts` invalidates `teams`.
 */
export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // `saison_id` is the only granular dimension: no mutation in the app changes gruppe,
  // disqualifikation or in_gruppen. `statistik_scope` is a cache KEY, not a tag, so `teams` clears
  // both scopes.
  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsResponse>("/teams", FLTeamsResponseSchema, {
    params: filters,
  });
}

/**
 * `null` on a 404, and **the conversion must stay INSIDE this function**: an error thrown out of a
 * `"use cache"` scope reaches the caller redacted to a digest, so a catch at the call site cannot
 * recognise it. Other errors still throw.
 */
export async function getTeam(teamId: string, filters: FLTeamSingleFilterParams = {}): Promise<FLTeamsSingleResponse | null> {
  "use cache";

  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsSingleResponse>(`/teams/${teamId}`, FLTeamsSingleResponseSchema, {
    params: filters,
  }).catch((error: unknown) => {
    // A 404 is "no such team" OR "no junction row for this season": the join is strict
    // (`docs/backend/spec.md` I11).
    if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
    throw error;
  });
}

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, never on caller identity.
 */
export async function getTeamMemberships(): Promise<FLTeamsMembershipsResponse> {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLTeamsMembershipsResponse>("/teams/memberships", FLTeamsMembershipsResponseSchema, { authType: "admin" }),
  );
}
