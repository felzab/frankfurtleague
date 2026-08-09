/**
 * SPIELTAGE · cached read
 *
 * Invariants:
 * - Base tag only, cleared by `actions.ts` on every write — nothing narrower describes one (ADR-0001).
 * - A Compass edit is served stale until the daily cacheLife expires (ADR-0035).
 * - Matchdays arrive in played order (ADR-0064); no consumer re-sorts, and the bracket depends on it.
 * - Omitting `saison_id` yields the current season — the backend resolves it.
 *
 * See:
 * - docs/glossary.md — Spieltag, and why it is not a Spiel
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
