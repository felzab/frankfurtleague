import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { FLSpieltageFilterParams } from "./types";
import { type FLSpieltageListResponse, FLSpieltageListResponseSchema } from "./schemas";

export async function getSpieltage(filters: FLSpieltageFilterParams = {}): Promise<FLSpieltageListResponse> {
  "use cache";

  const tags: string[] = ["spieltage"];
  if (filters.saison_id) tags.push(`spieltage:season:${filters.saison_id}`);
  if (filters.saison_phase) tags.push(`spieltage:phase:${filters.saison_phase}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSpieltageListResponse>("/spieltage", FLSpieltageListResponseSchema, {
    params: filters as Record<string, string | number | boolean>,
  });
}
