import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSchiedsrichterListResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  "use cache";

  const tags: string[] = ["schiedsrichter"];
  if (filters.default_payment) tags.push(`spieler:default_payment:${filters.default_payment}`);
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
    params: filters as Record<string, string | number | boolean>,
  });
}
