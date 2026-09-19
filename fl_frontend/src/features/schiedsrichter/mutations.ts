import { apiClient } from "@/core/api";

import { FLPatchSchiedsrichterResponseSchema, FLPostSchiedsrichterResponseSchema, FLSchiedsrichterWriteResponseSchema } from "./schemas";

import type {
  FLAnonymiseSchiedsrichterPayload,
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

/** The id goes in the path, never the body: the backend model refuses a body that names one. */
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

// Deletes the row and repoints every fixture that named them at the ghost, in one transaction. The
// echoed document is the referee as they last stood, there being nothing left to read back.
export async function anonymiseSchiedsrichter({ id }: FLAnonymiseSchiedsrichterPayload): Promise<FLSchiedsrichterWriteResponse> {
  return apiClient<FLSchiedsrichterWriteResponse>(`/schiedsrichter/${id}/anonymisieren`, FLSchiedsrichterWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
