import { apiClient } from "@/core/api";

import { FLPatchSpielDataResponseSchema } from "./schemas";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLPatchSpielPaarungPayload } from "./schemas";

/** Its OWN response schema, never the read model: `strip` would silently drop the moved fixtures. */
export const patchAdminSpielData = async ({ spiel_id, ...fields }: FLPatchSpielDataPayload): Promise<FLPatchSpielDataResponse> => {
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
};

/**
 * Puts one fixture's occupants and result back where a save's bracket resolution rewrote them.
 * **Its own endpoint, not `patchAdminSpielData` with fewer fields**: that one writes wholesale, so a
 * field left out of it is erased rather than kept.
 */
export const patchAdminSpielPaarung = async ({ spiel_id, ...paarung }: FLPatchSpielPaarungPayload): Promise<FLPatchSpielDataResponse> => {
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}/paarung`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(paarung),
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
