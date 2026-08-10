/**
 * TEAMS · the club reads
 *
 * Teams are reference data and cached for days, except `getTeamMemberships`, which is admin-authed
 * and therefore never cached (ADR-0009). The one thing that invalidates them is a Spiel
 * result edit — statistics are derived from the match documents on every read (ADR-0019), so a
 * result edit changes this response without touching a team document. The invalidation therefore
 * lives in `features/spiele/actions.ts`, and dropping it as "unrelated" strands a public table.
 *
 * Invariants:
 * - `teams:saison_id:*` is the only granular tag — no mutation changes the other dimensions.
 * - A team with no junction row for the requested season is simply absent.
 * - `statistik_scope` is cache KEY, not tag — the `teams` tag clears both scopes, as a result
 *   edit needs.
 *
 * See:
 * - docs/glossary.md — "Team" for the junction model, "Statistik" for how the table is derived
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";

import { FLTeamsMembershipsResponseSchema, FLTeamsResponseSchema, FLTeamsSingleResponseSchema } from "./schemas";

import type { FLTeamsMembershipsResponse, FLTeamsResponse, FLTeamsSingleResponse } from "./schemas";
import type { FLTeamsFilterParams, FLTeamSingleFilterParams } from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // The only granular tag kept for this resource (ADR-0001): a result change alters the season's team
  // statistics and nothing outside it, because the backend derives the table from that season's
  // matches alone (ADR-0019).

  // No gruppe, disqualifikation or in_gruppen tags -- no mutation in the app changes those
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
 * One team by its id, for the pages whose subject IS that team (ADR-0027).
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
 * **Uncached, and it stays uncached (ADR-0009).** `"use cache"` keys on a function's arguments and
 * never on caller identity, so a zero-argument admin-authed read cached here is one shared slot
 * holding data fetched with credentials no later caller presented. It carries no cache tag either:
 * a tag only means something inside a cache scope. The cost is one backend request per admin page
 * load.
 */
export async function getTeamMemberships(): Promise<FLTeamsMembershipsResponse> {
  return apiClient<FLTeamsMembershipsResponse>("/teams/memberships", FLTeamsMembershipsResponseSchema, { authType: "admin" });
}
