import { apiClient } from "@/core/api";
import { cacheLife, cacheTag } from "next/cache";
import type { FLSpielorteFilterParams, FLSpielorteListResponse } from "./types";

export async function getSpielorte(filters: FLSpielorteFilterParams = {}): Promise<FLSpielorteListResponse> {
  "use cache";

  const tags: string[] = ["spielorte"];
  cacheTag(...tags);
  cacheLife("days");

  return apiClient<FLSpielorteListResponse>("/spielorte", {
    params: filters as Record<string, string | number | boolean>,
  });
}
