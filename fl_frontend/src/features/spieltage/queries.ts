/**
 * SPIELTAGE · cached read
 *
 * Invariants:
 * - Base tag only, cleared by `actions.ts` on every write — nothing narrower describes one (ADR-0001).
 * - A Compass edit is served stale until the daily cacheLife expires (ADR-0028).
 * - Matchdays arrive in played order (ADR-0051); no consumer re-sorts, and the bracket depends on it.
 * - Omitting `saison_id` yields the current season — the backend resolves it.
 *
 * See:
 * - docs/glossary.md — Spieltag, and why it is not a Spiel
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpieltageListResponseSchema, FLSpieltageSingleResponseSchema } from "./schemas";

import type { FLSpieltageListResponse, FLSpieltageSingleResponse } from "./schemas";
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

/**
 * One matchday by its id, retired ones included — what the editor route resolves before it knows
 * which season to ask about (ADR-0027 kept this endpoint for exactly that addressability).
 *
 * Base tag only, like the list beside it: every matchday write clears `spieltage`, and a granular tag
 * per id would be one nothing invalidates on a write that moved a DIFFERENT matchday past this one
 * (ADR-0001). It is a public read under the base key, so `"use cache"` is correct here — the rule
 * against caching is about ADMIN-scoped reads, which key on arguments rather than on caller identity
 * (ADR-0009).
 */
export async function getSpieltagById(spieltagId: string): Promise<FLSpieltageSingleResponse> {
  "use cache";

  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageSingleResponse>(`/spieltage/${spieltagId}`, FLSpieltageSingleResponseSchema);
}
