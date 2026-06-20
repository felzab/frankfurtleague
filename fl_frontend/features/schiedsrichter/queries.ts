import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { FLSchiedsrichterFilterParams } from "./types";
import { FLSchiedsrichterListResponseSchema, type FLSchiedsrichterListResponse } from "./schemas";

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
