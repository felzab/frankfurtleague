/**
 * SPIELTAGE · cached read
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only, and `actions.ts` in this slice clears it on every matchday write. Nothing narrower
 *     would describe one: the admin list spans a season's matchdays including retired ones while the
 *     public Spielplan reads whichever season is current, so one write moves both (ADR-0001).
 *   • A hand edit made directly in MongoDB goes around that and is served stale until the daily
 *     cacheLife expires or the container is recreated. There is no invalidation endpoint, by decision
 *     (ADR-0035).
 *   • Matchdays come back in the order they are PLAYED, derived by the backend from `saison_phase` in
 *     bracket order, then `beginn`, then `name` (ADR-0064). No consumer re-sorts them, and the playoff
 *     bracket's column order depends on that arrival order being right.
 *   • Omitting `saison_id` yields the current season — the backend resolves it.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — Spieltag, and why it is not a Spiel
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpieltageListResponseSchema } from "./schemas";

import type { FLSpieltageListResponse } from "./schemas";
import type { FLSpieltageFilterParams } from "./types";

export async function getSpieltage(filters: FLSpieltageFilterParams = {}): Promise<FLSpieltageListResponse> {
  "use cache";

  // Base tag only: one matchday write moves both the season-scoped admin list and the public
  // Spielplan's default-season entry, so no granular tag describes it. Per CLAUDE.md §6, granular
  // tags belong on `spiele` and `teams` alone.
  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageListResponse>("/spieltage", FLSpieltageListResponseSchema, {
    params: filters,
  });
}
