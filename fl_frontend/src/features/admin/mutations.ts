import { apiClient } from "@/core/api";
import { BaseAPIResponseSchema } from "@/core/schemas";

import type { BaseAPIResponse } from "@/core/schemas";
import type { FLPatchSpielDataPayload } from "./schemas";

export const patchAdminSpielData = async (formData: FLPatchSpielDataPayload): Promise<BaseAPIResponse> => {
  return apiClient<BaseAPIResponse>("/admin/update_spiel_data", BaseAPIResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(formData),
  });
};
