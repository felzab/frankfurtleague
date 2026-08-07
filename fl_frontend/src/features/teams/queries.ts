/**
 * TEAMS · cached read
 *
 * Teams are reference data and cached for days. The one thing that invalidates them is a Spiel result
 * edit, and the invalidation therefore lives in `features/spiele/actions.ts`, not here.
 *
 * **A result edit writes nothing a team query reads, and still changes this response.** Team
 * statistics are derived from the match documents on every read (ADR-0026), so editing a Spiel moves
 * the league table without touching a single team document. The invalidation in the Spiel action is
 * what connects the two; dropping it as "unrelated" would leave a visibly stale table on a public
 * page for up to a day.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `teams:saison_id:*` is the only granular tag for this resource. No tags on gruppe,
 *     disqualification or the rest: no mutation in the app changes those dimensions.
 *   • A team is season-independent; gruppe and disqualifikation come from a junction the backend joins
 *     at read time, and statistik is computed from that season's matches. A team with no junction row
 *     for the requested season is simply absent.
 *   • `statistik_scope` is part of the cache KEY, not the tag set. The two scopes are two entries of
 *     the same resource, and the `teams` tag clears both — which is what a result edit needs, since a
 *     playoff result moves one of them and a Gruppenphase result moves both.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — "Team", for the junction model and "Statistik", for how the table is derived
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";

import { FLTeamsMembershipsResponseSchema, FLTeamsResponseSchema, FLTeamsSingleResponseSchema } from "./schemas";

import type { FLTeamsMembershipsResponse, FLTeamsResponse, FLTeamsSingleResponse } from "./schemas";
import type { FLTeamsFilterParams, FLTeamSingleFilterParams } from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // The only granular tag kept for this resource (ADR-0001): a result change alters the season's
  // team statistics and nothing outside that season. The granularity is honest because the backend
  // derives the table from that season's matches alone (ADR-0026) -- no other season's rows move.
  // No gruppe / disqualifikation / in_gruppen tags -- no mutation in the app changes any of those
  // dimensions.
  const tags: string[] = ["teams"];
  if (filters.saison_id) tags.push(`teams:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLTeamsResponse>("/teams", FLTeamsResponseSchema, {
    params: filters,
  });
}

/**
 * One team by its id, for the pages whose subject IS that team (ADR-0034).
 *
 * Tagged exactly as `getTeams` is, because it reads the same documents through the same derivation —
 * a result edit moves this response too, and it is the `teams` tag that clears it.
 *
 * **Resolves `null` on a 404 — no such team, or no junction row for the requested season (the join is
 * strict) — and the conversion must stay INSIDE this function.** In a production build, an error
 * thrown out of a `"use cache"` scope reaches the awaiting caller redacted to a digest-only `Error`,
 * so a catch at the call site can never recognise the 404: both detail pages rendered the error page
 * for an unknown id. Only the 404 becomes a value; everything else still throws, so a backend outage
 * never reads as a missing team. The cached `null` is cleared by the same `teams` tag as any hit —
 * entering a club into a season invalidates it in the same action.
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
    if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
    throw error;
  });
}

/**
 * Every team with every season membership it holds, for the admin surfaces (`GET
 * /teams/memberships`, admin-authed). The one read behind the club list and the club editor,
 * replacing a request per season: the season-scoped reads cannot answer a club-centric question.
 *
 * Cached under the same `teams` tag as the other team reads, because every team action already
 * invalidates it — the base tag is what makes an admin edit visible here immediately. The
 * action-required read stays uncached by decision (ADR-0013); this list has none of its
 * freshness-over-everything character.
 */
export async function getTeamMemberships(): Promise<FLTeamsMembershipsResponse> {
  "use cache";

  cacheTag("teams");
  cacheLife("days");

  return apiClient<FLTeamsMembershipsResponse>("/teams/memberships", FLTeamsMembershipsResponseSchema, { authType: "admin" });
}
