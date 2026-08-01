/**
 * SCHIEDSRICHTER · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All three use `authType: "admin"`; the backend's admin router rejects the base key.
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
  return apiClient<FLPostSchiedsrichterResponse>("/admin/post_schiedsrichter", FLPostSchiedsrichterResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSchiedsrichterPayload),
  });
}

export async function patchSchiedsrichter(patchSchiedsrichterPayload: FLPatchSchiedsrichterPayload): Promise<FLPatchSchiedsrichterResponse> {
  return apiClient<FLPatchSchiedsrichterResponse>("/admin/patch_schiedsrichter", FLPatchSchiedsrichterResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(patchSchiedsrichterPayload),
  });
}

// This is a soft delete
export async function deleteSchiedsrichter(
  deleteSchiedsrichterPayload: FLDeleteSchiedsrichterPayload,
): Promise<FLDeleteSchiedsrichterResponse> {
  return apiClient<FLDeleteSchiedsrichterResponse>("/admin/delete_schiedsrichter", FLDeleteSchiedsrichterResponseSchema, {
    method: "DELETE",
    authType: "admin",
    body: JSON.stringify(deleteSchiedsrichterPayload),
  });
}
