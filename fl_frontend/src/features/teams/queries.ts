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
 *   • A team is season-independent; gruppe and is_disqualified come from a junction the backend joins
 *     at read time, and statistik is computed from that season's matches. A team with no junction row
 *     for the requested season is simply absent.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — "Team", for the junction model and "Statistik", for how the table is derived
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLTeamsResponseSchema } from "./schemas";

import type { FLTeamsResponse } from "./schemas";
import type { FLTeamsFilterParams } from "./types";

export async function getTeams(filters: FLTeamsFilterParams = {}): Promise<FLTeamsResponse> {
  "use cache";

  // The only granular tag kept for this resource (ADR-0001): a result change alters the season's
  // team statistics and nothing outside that season. The granularity is honest because the backend
  // derives the table from that season's matches alone (ADR-0026) -- no other season's rows move.
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
