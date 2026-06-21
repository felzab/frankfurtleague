import { apiClient } from "@/core/api";

import { FLSpieleListResponseSchema } from "../spiele/schemas";

import type { FLSpieleListResponse } from "../spiele/schemas";

export const getAdminSpieleActionRequired = async (): Promise<FLSpieleListResponse> => {
  return apiClient<FLSpieleListResponse>("/admin/action_required", FLSpieleListResponseSchema, { authType: "admin" });
};
