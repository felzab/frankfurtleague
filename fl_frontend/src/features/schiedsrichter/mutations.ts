/**
 * SCHIEDSRICHTER · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All three use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The id goes in the PATH and never in the body** (ADR-0034). The payload schemas still carry it,
 * because they back the admin form and the form has to know which referee it is editing — so each
 * mutation below splits it off. A backend payload model that saw an `id` would drop it silently.
 */

import { apiClient } from "@/core/api";

import { FLDeleteSchiedsrichterResponseSchema, FLPatchSchiedsrichterResponseSchema, FLPostSchiedsrichterResponseSchema } from "./schemas";

import type {
  FLDeleteSchiedsrichterPayload,
  FLDeleteSchiedsrichterResponse,
  FLPatchSchiedsrichterPayload,
  FLPatchSchiedsrichterResponse,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
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

// Soft: the backend stamps `inactive_since` and removes nothing (ADR-0032).
export async function deleteSchiedsrichter({ id }: FLDeleteSchiedsrichterPayload): Promise<FLDeleteSchiedsrichterResponse> {
  return apiClient<FLDeleteSchiedsrichterResponse>(`/schiedsrichter/${id}`, FLDeleteSchiedsrichterResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}
