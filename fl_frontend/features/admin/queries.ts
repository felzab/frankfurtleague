import { apiClient } from "@/core/api";
import type { FLSpieleListResponse } from "../spiele/types";

export const getAdminSpieleActionRequired = async (): Promise<FLSpieleListResponse> => {
  return apiClient<FLSpieleListResponse>("/admin/action_required", { authType: "admin" });
};
