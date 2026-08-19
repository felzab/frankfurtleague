/**
 * SPIELORTE · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All four use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The id goes in the PATH and never in the body**. The payload schemas still carry it,
 * because they back the admin form and the form has to know which venue it is editing — so each
 * mutation below splits it off. A backend payload model that saw an `id` would drop it silently.
 */

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

// The way back out of the soft delete: clearing `inactive_since` returns the venue to the picker and
// to every default read, which is what makes retirement a state rather than a disappearance.
export async function reactivateSpielort({ id }: FLSpielortKeyPayload): Promise<FLSpielortWriteResponse> {
  return apiClient<FLSpielortWriteResponse>(`/spielorte/${id}/reactivate`, FLSpielortWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
