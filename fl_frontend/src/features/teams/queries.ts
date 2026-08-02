/**
 * TEAMS · cached read
 *
 * Teams are reference data and cached for days. The one thing that invalidates them is a Spiel result
 * edit, because the backend rewrites team statistics as part of that write — the invalidation
 * therefore lives in `features/spiele/actions.ts`, not here.
 *
 * That write currently lands on the wrong collection and never reaches the statistics this read
 * serves (open item F4, confirmed 2026-08-02), so the invalidation is presently clearing a cache
 * whose contents did not change. Keep it: it is correct for the fixed write path, and dropping it
 * would leave a stale table the moment F4 is closed.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `teams:saison_id:*` is the only granular tag for this resource. No tags on gruppe,
 *     disqualification or the rest: no mutation in the app changes those dimensions.
 *   • A team is season-independent; gruppe, statistik and is_disqualified come from a junction the
 *     backend joins at read time. A team with no row for the requested season is simply absent.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — "Team", for the junction model and a known issue affecting statistik
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLTeamsResponseSchema } from "./schemas";

import type { FLTeamsResponse } from "./schemas";
import type { FLTeamsFilterParams } from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // The only granular tag kept for this resource (ADR-0001): patch_spiel_data calls
  // update_team_statistik, so a result change is meant to rewrite team stats within that season
  // only -- the write is not yet season-scoped, which is F4's second face.
  // No gruppe / include_placeholders / is_disqualified / in_gruppen tags -- no mutation
  // in the app changes any of those dimensions.
  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsResponse>("/teams", FLTeamsResponseSchema, {
    params: filters,
  });
}
