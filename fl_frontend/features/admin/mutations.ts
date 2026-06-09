import { apiClient } from "@/core/api";
import type { PatchAdminSpielDataPayload, PatchAdminSpielDataReturn } from "./types";

export const patchAdminSpielData = async (formData: PatchAdminSpielDataPayload): Promise<PatchAdminSpielDataReturn> => {
  return apiClient<PatchAdminSpielDataReturn>("/admin/update_spiel_data", {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(formData),
  });
};
