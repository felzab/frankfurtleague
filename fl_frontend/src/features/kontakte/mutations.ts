import { apiClient } from "@/core/api";

import { FLKontaktErasureResponseSchema, FLPatchSaisonTeamKontakteResponseSchema } from "./schemas";

import type {
  FLKontaktErasurePayload,
  FLKontaktErasureResponse,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
} from "./schemas";

/**
 * The address travels in the BODY, never in a path or a query: those would file it in the access
 * log, in nginx's log and in `aktionen.request.path` at once. Hence a POST, a DELETE's body having
 * no defined semantics (RFC 9110 §9.3.5).
 */
export async function eraseKontaktperson(payload: FLKontaktErasurePayload): Promise<FLKontaktErasureResponse> {
  return apiClient<FLKontaktErasureResponse>("/kontakte/erasure", FLKontaktErasureResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// Both ids go in the PATH, as every junction write spells them — a backend payload model that saw
// one refuses the whole body (frontend spec 1.3).
export async function patchSaisonTeamKontakte({
  team_id,
  saison_id,
  ...body
}: FLPatchSaisonTeamKontaktePayload): Promise<FLPatchSaisonTeamKontakteResponse> {
  return apiClient<FLPatchSaisonTeamKontakteResponse>(
    `/teams/${team_id}/saisons/${saison_id}/kontakte`,
    FLPatchSaisonTeamKontakteResponseSchema,
    {
      method: "PATCH",
      authType: "admin",
      body: JSON.stringify(body),
    },
  );
}
