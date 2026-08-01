/**
 * SPIELORTE · cached read
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only, and that is sufficient: this slice's own actions invalidate `spielorte` on every
 *     write, so the day-long lifetime never strands an admin edit.
 *   • A venue rename also invalidates `spiele`, because the backend fans the new name out into every
 *     match embedding it — the match data really has changed.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 3, the action inventory
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
