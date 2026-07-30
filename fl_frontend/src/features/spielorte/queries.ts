import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSpielorteListResponseSchema } from "./schemas";

import type { FLSpielorteListResponse } from "./schemas";
import type { FLSpielorteFilterParams } from "./types";

export async function getSpielorte(filters: FLSpielorteFilterParams = {}): Promise<FLSpielorteListResponse> {
  "use cache";

  const tags: string[] = ["spielorte"];
  if (filters.is_inactive !== undefined) tags.push(`spielorte:is_inactive:${filters.is_inactive}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSpielorteListResponse>("/spielorte", FLSpielorteListResponseSchema, {
    params: filters,
  });
}
