import { apiClient } from "@/core/api";

import { FLPatchSpielDataResponseSchema } from "./schemas";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse } from "./schemas";

/** Its OWN response schema, never the read model: `strip` would silently drop the moved fixtures. */
export const patchAdminSpielData = async ({ spiel_id, ...fields }: FLPatchSpielDataPayload): Promise<FLPatchSpielDataResponse> => {
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
};

/**
 * **Deliberately the same endpoint, payload and response schema as the save.** Its own would be a
 * second implementation of the refusal rules, and once the two disagreed the warning would name the
 * wrong fixtures — worse than none.
 */
export const previewAdminSpielData = async ({ spiel_id, ...fields }: FLPatchSpielDataPayload): Promise<FLPatchSpielDataResponse> => {
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}?dry_run=true`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
};
