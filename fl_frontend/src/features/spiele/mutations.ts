import { apiClient } from "@/core/api";

import { FLPatchSpielDataResponseSchema, FLPatchSpielePaarungenResponseSchema } from "./schemas";

import type {
  FLPatchSpielDataPayload,
  FLPatchSpielDataResponse,
  FLPatchSpielePaarungenPayload,
  FLPatchSpielePaarungenResponse,
} from "./schemas";

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
 * Puts every fixture a save's bracket resolution rewrote back where it stood, in one request.
 * **Its own endpoint, not `patchAdminSpielData` with fewer fields**: that one writes wholesale, so a
 * field left out of it is erased rather than kept.
 */
// **One request and not one per fixture**: a loop here would leave a season half restored, with the
// only copy of the rest in a toast the press has already dismissed.
export const patchAdminSpielePaarungen = async (payload: FLPatchSpielePaarungenPayload): Promise<FLPatchSpielePaarungenResponse> => {
  return apiClient<FLPatchSpielePaarungenResponse>("/spiele/paarungen", FLPatchSpielePaarungenResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(payload),
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
