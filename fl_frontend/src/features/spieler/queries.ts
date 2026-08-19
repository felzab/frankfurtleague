/**
 * SPIELER · the player reads
 *
 * Invariants:
 * - Base tag only on the cached read — it spans every season, so no granular tag names a save.
 * - `getSpielerMemberships` is admin-authed and therefore never cached.
 * - Only `vorname` is guaranteed present; a squad is filled in over time.
 * - `getSpieler` flattens against one season; the admin surfaces read `getSpielerMemberships`.
 *
 * See:
 * - docs/frontend/spec.md — section 1.5, out-of-band invalidation
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpielerListResponseSchema, FLSpielerMembershipsResponseSchema } from "./schemas";

import type { FLSpielerListResponse, FLSpielerMembershipsResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only, and load-bearing: every admin spieler action clears this tag, so a squad edit
  // reaches the public squad lists at once.
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
 * **Uncached, and it stays uncached.** `"use cache"` keys on a function's arguments and
 * never on caller identity, so a zero-argument admin-authed read cached here is one shared slot
 * holding data fetched with credentials no later caller presented. It carries no cache tag either —
 * a tag means nothing outside a cache scope — and one page load can pay for this read more than
 * once; `docs/frontend/spec.md` section 1.2 carries the rule and the cost. Being uncached is also
 * what lets it run inside `runWithIncomingCorrelationId` (`docs/logging/spec.md`).
 */
export async function getSpielerMemberships(): Promise<FLSpielerMembershipsResponse> {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" }),
  );
}
