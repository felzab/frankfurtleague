import { apiClient } from "@/core/api";
import { type FLSpieleListResponse, FLSpieleListResponseSchema } from "../spiele/schemas";

export const getAdminSpieleActionRequired = async (): Promise<FLSpieleListResponse> => {
  return apiClient<FLSpieleListResponse>("/admin/action_required", FLSpieleListResponseSchema, { authType: "admin" });
};
