import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { FLSchiedsrichterListResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  "use cache";

  // Base tag only: every referee write clears the whole list, and `include_inactive` splits this into
  // two entries under one tag rather than into two things to invalidate.
  cacheTag("schiedsrichter");
  cacheLife("days");

  return apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
    params: filters,
  });
}
