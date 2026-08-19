/**
 * SCHIEDSRICHTER · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All four use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The id goes in the PATH and never in the body**. The payload schemas still carry it,
 * because they back the admin form and the form has to know which referee it is editing — so each
 * mutation below splits it off. A backend payload model that saw an `id` would drop it silently.
 */

import { apiClient } from "@/core/api";

import { FLPatchSchiedsrichterResponseSchema, FLPostSchiedsrichterResponseSchema, FLSchiedsrichterWriteResponseSchema } from "./schemas";

import type {
  FLPatchSchiedsrichterPayload,
  FLPatchSchiedsrichterResponse,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLSchiedsrichterKeyPayload,
  FLSchiedsrichterWriteResponse,
} from "./schemas";

export async function postSchiedsrichter(postSchiedsrichterPayload: FLPostSchiedsrichterPayload): Promise<FLPostSchiedsrichterResponse> {
  return apiClient<FLPostSchiedsrichterResponse>("/schiedsrichter", FLPostSchiedsrichterResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSchiedsrichterPayload),
  });
}

export async function patchSchiedsrichter({ id, ...fields }: FLPatchSchiedsrichterPayload): Promise<FLPatchSchiedsrichterResponse> {
  return apiClient<FLPatchSchiedsrichterResponse>(`/schiedsrichter/${id}`, FLPatchSchiedsrichterResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterWriteResponse> {
  return apiClient<FLSchiedsrichterWriteResponse>(`/schiedsrichter/${id}`, FLSchiedsrichterWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// The way back out of the soft delete: clearing `inactive_since` returns the referee to the picker and
// to every default read, which is what makes retirement a state rather than a disappearance.
export async function reactivateSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterWriteResponse> {
  return apiClient<FLSchiedsrichterWriteResponse>(`/schiedsrichter/${id}/reactivate`, FLSchiedsrichterWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
