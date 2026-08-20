import { apiClient } from "@/core/api";

import { FLSpieltagWriteResponseSchema } from "./schemas";

import type { FLPatchSpieltagPayload, FLPostSpieltagPayload, FLSpieltagWriteResponse } from "./schemas";

export async function postSpieltag(payload: FLPostSpieltagPayload): Promise<FLSpieltagWriteResponse> {
  return apiClient<FLSpieltagWriteResponse>("/spieltage", FLSpieltagWriteResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// `saison_id` is not on the payload: moving a matchday between seasons would strand its matches,
// which carry their own.
export async function patchSpieltag({ id, ...fields }: FLPatchSpieltagPayload): Promise<FLSpieltagWriteResponse> {
  return apiClient<FLSpieltagWriteResponse>(`/spieltage/${id}`, FLSpieltagWriteResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}
