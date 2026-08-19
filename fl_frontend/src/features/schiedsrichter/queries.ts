/**
 * SCHIEDSRICHTER · cached read
 *
 * Invariants:
 * - Base tag only, and sufficient: this slice's actions invalidate `schiedsrichter` on every write.
 * - A referee rename also invalidates `spiele` — the backend fans the new name into every match.
 * - `include_inactive` is the one filter any caller passes; the rest are unexercised, not tested.
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSchiedsrichterListResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  "use cache";

  // Base tag only: every referee write clears the whole list, and `include_inactive` splits this into
  // two entries under one tag rather than into two things to invalidate (ADR-0001).
  cacheTag("schiedsrichter");
  cacheLife("days");

  return apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
    params: filters,
  });
}
