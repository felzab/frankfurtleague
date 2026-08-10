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

  // Base tag only. The spielorte actions already invalidate this tag on every write.
  cacheTag("spielorte");
  cacheLife("days");

  return apiClient<FLSpielorteListResponse>("/spielorte", FLSpielorteListResponseSchema, {
    params: filters,
  });
}
