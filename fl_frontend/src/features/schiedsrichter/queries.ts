/**
 * SCHIEDSRICHTER · cached read
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Base tag only, and sufficient: this slice's actions invalidate `schiedsrichter` on every write.
 *   • A referee rename also invalidates `spiele`, because the backend fans the new name into every
 *     match embedding it.
 *   • This is called with no arguments everywhere in the app. The filter parameters exist but are
 *     unexercised — do not assume they are tested behaviour.
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSchiedsrichterListResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  "use cache";

  // Base tag only. The granular tag that once sat here was misnamespaced (`spieler:`) and on a branch
  // that never ran, since this is only ever called with no arguments.
  cacheTag("schiedsrichter");
  cacheLife("days");

  return apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
    params: filters,
  });
}
