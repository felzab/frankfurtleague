/**
 * SPIELTAGE · cached read
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only. `spieltage` has no frontend write surface, so nothing in the app can invalidate a
 *     granular tag on it; the out-of-band revalidation route clears the coarse one.
 *   • Matchdays come back ordered by `order_val`, not by date. The bracket depends on that order, and
 *     matchdays routinely share dates.
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

  // Base tag only: `spieltage` has no frontend write surface, so its granular tags could never be
  // invalidated. Per CLAUDE.md §6, granular tags belong on `spiele` and `teams` alone.
  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageListResponse>("/spieltage", FLSpieltageListResponseSchema, {
    params: filters,
  });
}
