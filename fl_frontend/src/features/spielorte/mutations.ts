/**
 * SPIELORTE · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All three use `authType: "admin"`; the backend's admin router rejects the base key.
 */

import { apiClient } from "@/core/api";

import { FLDeleteSpielortResponseSchema, FLPatchSpielortResponseSchema, FLPostSpielortResponseSchema } from "./schemas";

import type {
  FLDeleteSpielortPayload,
  FLDeleteSpielortResponse,
  FLPatchSpielortPayload,
  FLPatchSpielortResponse,
  FLPostSpielortPayload,
  FLPostSpielortResponse,
} from "./schemas";

export async function postSpielort(postSpielortPayload: FLPostSpielortPayload): Promise<FLPostSpielortResponse> {
  return apiClient<FLPostSpielortResponse>("/admin/post_spielort", FLPostSpielortResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSpielortPayload),
  });
}

export async function patchSpielort(patchSpielortPayload: FLPatchSpielortPayload): Promise<FLPatchSpielortResponse> {
  return apiClient<FLPatchSpielortResponse>("/admin/patch_spielort", FLPatchSpielortResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(patchSpielortPayload),
  });
}

// This is a soft delete
export async function deleteSpielort(deleteSpielortPayload: FLDeleteSpielortPayload): Promise<FLDeleteSpielortResponse> {
  return apiClient<FLDeleteSpielortResponse>("/admin/delete_spielort", FLDeleteSpielortResponseSchema, {
    method: "DELETE",
    authType: "admin",
    body: JSON.stringify(deleteSpielortPayload),
  });
}
