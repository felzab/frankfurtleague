/**
 * SPIELER · cached reads
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only. Every write here is either to the person, which is season-independent, or to a
 *     squad row whose season the caller of the granular tag would have to know — and both admin reads
 *     span every season, so no granular tag would name what a save changes (ADR-0001's rule, applied).
 *   • Only `vorname` is guaranteed present on a player; surname, number, position and stufe may all be
 *     null, because a squad is filled in over time.
 *   • `getSpieler` is FLATTENED against one season and `getSpielerMemberships` is not. The admin
 *     surfaces read the second, and the reasons the first cannot serve them are on the endpoint.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 5, out-of-band invalidation
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpielerListResponseSchema, FLSpielerMembershipsResponseSchema } from "./schemas";

import type { FLSpielerListResponse, FLSpielerMembershipsResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only, and now load-bearing rather than incidental: the admin write surface exists, and
  // every one of its actions clears this tag, so a squad edit reaches the public squad lists at once.
  cacheTag("spieler");
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
  });
}

/**
 * Every player with every squad row they hold, for the admin surfaces (`GET /spieler/memberships`,
 * admin-authed). The one read behind the player list and the squad editor.
 *
 * `getSpieler` cannot serve either, at any filter setting: with a season its junction join is strict,
 * so a player with no row that season is invisible to the only list that could give them one; without
 * one it flattens the junction, so a player with no row at all comes back missing the `team_id`
 * `FLSpielerSchema` requires and the parse fails for everyone. The endpoint's docstring carries the
 * third reason and the measurements.
 *
 * Cached under the same `spieler` tag as the read above, because every spieler action already
 * invalidates it — the base tag is what makes an admin edit visible here immediately.
 */
export async function getSpielerMemberships(): Promise<FLSpielerMembershipsResponse> {
  "use cache";

  cacheTag("spieler");
  cacheLife("days");

  return apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" });
}
