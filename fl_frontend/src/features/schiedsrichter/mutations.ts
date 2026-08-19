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

/**
 * The id goes in the path and never in the body: the payload schema carries it for the form, so each
 * mutation splits it off, and a backend model that saw an `id` would drop it silently.
 */
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

// Clearing `inactive_since` returns the referee to the picker and to every default read, which makes
// retirement a state rather than a disappearance.
export async function reactivateSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterWriteResponse> {
  return apiClient<FLSchiedsrichterWriteResponse>(`/schiedsrichter/${id}/reactivate`, FLSchiedsrichterWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
