/**
 * SPIELER · cached read
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only. `spieler` has no frontend write surface, so no action can invalidate a granular
 *     tag on it.
 *   • Squads are edited directly in the database, so a change is served stale for up to a day — a
 *     bound that is the whole mechanism (ADR-0035); recreating the container is the only faster path.
 *   • Only `vorname` is guaranteed present on a player; surname, number and position may all be null.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 5, out-of-band invalidation
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpielerListResponseSchema } from "./schemas";

import type { FLSpielerListResponse } from "./schemas";
import type { FLSpielerFilterParams } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only: `spieler` has no frontend write surface, so no action can invalidate a granular
  // tag on it. The out-of-band revalidation route now exists and clears this coarse tag; granularity
  // would only be worth adding if a full refresh proves too blunt in practice.
  cacheTag("spieler");
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
  });
}
