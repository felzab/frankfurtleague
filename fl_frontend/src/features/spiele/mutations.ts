import { apiClient } from "@/core/api";

import { FLPatchSpielDataResponseSchema } from "./schemas";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse } from "./schemas";

/**
 * Its OWN response schema, never the read model: `strip` would silently drop the moved fixtures.
 * `uebernimmtBericht` is the Spielbericht `version` the editor was seeded from, which the save stamps adopted.
 */
export const patchAdminSpielData = async (
  { spiel_id, ...fields }: FLPatchSpielDataPayload,
  uebernimmtBericht: number | null,
): Promise<FLPatchSpielDataResponse> => {
  // Left out unseeded: sent, it adopts whatever report stands at that version.
  const params: { uebernimmt_bericht?: number } = uebernimmtBericht === null ? {} : { uebernimmt_bericht: uebernimmtBericht };
  return apiClient<FLPatchSpielDataResponse>(`/spiele/${spiel_id}`, FLPatchSpielDataResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
    params: params,
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
    readOnly: true,
    authType: "admin",
    body: JSON.stringify(fields),
  });
};
