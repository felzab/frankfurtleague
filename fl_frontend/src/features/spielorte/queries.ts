/**
 * SPIELORTE · cached read
 *
 * Invariants:
 * - Base tag only, and sufficient: this slice's actions invalidate `spielorte` on every write.
 * - A venue rename also invalidates `spiele` — the backend fans the new name into every match.
 *
 * See:
 * - docs/frontend/spec.md — section 1.3, the action inventory
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpielorteListResponseSchema } from "./schemas";

import type { FLSpielorteListResponse } from "./schemas";
import type { FLSpielorteFilterParams } from "./types";

export async function getSpielorte(filters: FLSpielorteFilterParams = {}): Promise<FLSpielorteListResponse> {
  "use cache";

  // Base tag only: every venue write clears the whole list, and `include_inactive` splits this into
  // two entries under one tag rather than into two things to invalidate (ADR-0001).
  cacheTag("spielorte");
  cacheLife("days");

  return apiClient<FLSpielorteListResponse>("/spielorte", FLSpielorteListResponseSchema, {
    params: filters,
  });
}
