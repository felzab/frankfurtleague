import { apiClient, type BaseAPIResponse, BaseAPIResponseSchema } from "@/core/api";
import type { AdminPatchSpielDataPayload } from "./schemas";

export const patchAdminSpielData = async (formData: AdminPatchSpielDataPayload): Promise<BaseAPIResponse> => {
  return apiClient<BaseAPIResponse>("/admin/update_spiel_data", BaseAPIResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(formData),
  });
};
