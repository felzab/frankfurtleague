import { apiClient } from "@/core/api";

import { FLSpieltagWriteResponseSchema } from "./schemas";

import type { FLPatchSpieltagPayload, FLPostSpieltagPayload, FLSpieltagKeyPayload, FLSpieltagWriteResponse } from "./schemas";

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

// Soft: the backend stamps `inactive_since` and the document stays. Its matches stay readable —
// `GET /spiele` never joins `spieltage`, which is exactly why this is not a delete.
export async function deleteSpieltag({ id }: FLSpieltagKeyPayload): Promise<FLSpieltagWriteResponse> {
  return apiClient<FLSpieltagWriteResponse>(`/spieltage/${id}`, FLSpieltagWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

export async function reactivateSpieltag({ id }: FLSpieltagKeyPayload): Promise<FLSpieltagWriteResponse> {
  return apiClient<FLSpieltagWriteResponse>(`/spieltage/${id}/reactivate`, FLSpieltagWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
