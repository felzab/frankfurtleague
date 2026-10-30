import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { isRecordMissing } from "@/core/errors";
import { teamsGetTeam, teamsGetTeamMemberships, teamsGetTeams, teamsGetTeamsForAdmin } from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLTeamsGroupedResponse,
  FLTeamsListResponse,
  FLTeamsMembershipsResponse,
  FLTeamsSingleResponse,
  TeamsGetTeamParams,
  TeamsGetTeamsForAdminParams,
  TeamsGetTeamsParams,
} from "@/core/generated/client/types";

/** The list read's two shapes, told apart by `format`: `in_gruppen` asks for the grouped one. */
type FLTeamsResponse = FLTeamsListResponse | FLTeamsGroupedResponse;

/** Omitted, `saison_id` is the current season. */
export async function getTeams(filters: TeamsGetTeamsParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return teamsGetTeams(filters);
}

/**
 * `null` on a 404, and **the conversion must stay INSIDE this function**: an error thrown out of a
 * `"use cache"` scope reaches the caller redacted to a digest, so a catch at the call site cannot
 * recognise it. Other errors still throw.
 */
export async function getTeam(teamId: string, filters: TeamsGetTeamParams = {}): Promise<FLTeamsSingleResponse | null> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return teamsGetTeam(teamId, filters).catch((error: unknown) => {
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
export function getAdminTeams(filters: TeamsGetTeamsForAdminParams = {}): Promise<FLTeamsResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminTeamsInFlight().get(key);
  if (held !== undefined) return held;

  const started = runAdminRead(() => teamsGetTeamsForAdmin(filters));
  adminTeamsInFlight().set(key, started);

  return started;
}

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export const getTeamMemberships = cache(async (): Promise<FLTeamsMembershipsResponse> => runAdminRead(() => teamsGetTeamMemberships()));
