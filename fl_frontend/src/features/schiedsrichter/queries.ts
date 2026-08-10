/**
 * SCHIEDSRICHTER · cached read
 *
 * Invariants:
 * - Base tag only, and sufficient: this slice's actions invalidate `schiedsrichter` on every write.
 * - A referee rename also invalidates `spiele` — the backend fans the new name into every match.
 * - Called with no arguments everywhere; the filter parameters are unexercised, not tested.
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSchiedsrichterListResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  "use cache";

  // Base tag only: this is only ever called with no arguments, so nothing narrower describes it.
  cacheTag("schiedsrichter");
  cacheLife("days");

  return apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
    params: filters,
  });
}
