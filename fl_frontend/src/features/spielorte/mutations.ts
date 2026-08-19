import { apiClient } from "@/core/api";

import { FLPatchSpielortResponseSchema, FLPostSpielortResponseSchema, FLSpielortWriteResponseSchema } from "./schemas";

import type {
  FLPatchSpielortPayload,
  FLPatchSpielortResponse,
  FLPostSpielortPayload,
  FLPostSpielortResponse,
  FLSpielortKeyPayload,
  FLSpielortWriteResponse,
} from "./schemas";

export async function postSpielort(postSpielortPayload: FLPostSpielortPayload): Promise<FLPostSpielortResponse> {
  return apiClient<FLPostSpielortResponse>("/spielorte", FLPostSpielortResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSpielortPayload),
  });
}

/**
 * The id goes in the path and never in the body: the payload schema carries it for the form, so each
 * mutation splits it off, and a backend model that saw an `id` would drop it silently.
 */
export async function patchSpielort({ id, ...fields }: FLPatchSpielortPayload): Promise<FLPatchSpielortResponse> {
  return apiClient<FLPatchSpielortResponse>(`/spielorte/${id}`, FLPatchSpielortResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteSpielort({ id }: FLSpielortKeyPayload): Promise<FLSpielortWriteResponse> {
  return apiClient<FLSpielortWriteResponse>(`/spielorte/${id}`, FLSpielortWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// Clearing `inactive_since` returns the venue to the picker and to every default read, which makes
// retirement a state rather than a disappearance.
export async function reactivateSpielort({ id }: FLSpielortKeyPayload): Promise<FLSpielortWriteResponse> {
  return apiClient<FLSpielortWriteResponse>(`/spielorte/${id}/reactivate`, FLSpielortWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
