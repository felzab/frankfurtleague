import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLTeamsMembershipsResponseSchema, FLTeamsResponseSchema, FLTeamsSingleResponseSchema } from "./schemas";

import type { FLTeamsMembershipsResponse, FLTeamsResponse, FLTeamsSingleResponse } from "./schemas";
import type { FLPublicTeamsFilterParams, FLTeamsFilterParams, FLTeamSingleFilterParams } from "./types";

/**
 * Statistics are derived from the match documents on every read, so a Spiel result edit moves this
 * response without touching a team document — which is why
 * `fl_frontend/src/features/spiele/actions.ts` invalidates `teams`.
 */
export async function getTeams(filters: FLPublicTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // `saison_id` is the only granular tag: a rename reaches every open season at once, and a
  // junction write holds only the value it moves to (`docs/frontend/spec.md` §1.4).
  // `statistik_scope` is a cache KEY, not a tag, so `teams` clears both scopes.
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

/** One in-flight admin club read per filter set, held for the length of one render pass. */
const adminTeamsInFlight = cache((): Map<string, Promise<FLTeamsResponse>> => new Map());

/**
 * A season's clubs for the admin surfaces, a planned season's included — `getTeams` refuses that
 * season, though a club is entered into one while planned. **Uncached**: `docs/frontend/spec.md` §1.2.
 */
export function getAdminTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminTeamsInFlight().get(key);
  if (held !== undefined) return held;

  const started = runWithIncomingCorrelationId(() =>
    apiClient<FLTeamsResponse>("/teams/list/admin", FLTeamsResponseSchema, { authType: "admin", params: filters }),
  );
  adminTeamsInFlight().set(key, started);

  return started;
}

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller
// (`docs/frontend/spec.md` §1.2).
export const getTeamMemberships = cache(async (): Promise<FLTeamsMembershipsResponse> =>
  runWithIncomingCorrelationId(() =>
    apiClient<FLTeamsMembershipsResponse>("/teams/memberships", FLTeamsMembershipsResponseSchema, { authType: "admin" }),
  ),
);
