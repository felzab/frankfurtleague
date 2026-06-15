import { apiClient, BaseAPIResponse } from "@/core/api";
import type { PatchAdminSpielDataPayload } from "./types";

export const patchAdminSpielData = async (formData: PatchAdminSpielDataPayload): Promise<BaseAPIResponse> => {
  return apiClient<BaseAPIResponse>("/admin/update_spiel_data", {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(formData),
  });
};
