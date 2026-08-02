/**
 * SPIELORTE · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All three use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The id goes in the PATH and never in the body** (ADR-0034). The payload schemas still carry it,
 * because they back the admin form and the form has to know which venue it is editing — so each
 * mutation below splits it off. A backend payload model that saw an `id` would drop it silently.
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

// Soft: the backend stamps `inactive_since` and removes nothing (ADR-0032).
export async function deleteSpielort({ id }: FLDeleteSpielortPayload): Promise<FLDeleteSpielortResponse> {
  return apiClient<FLDeleteSpielortResponse>(`/spielorte/${id}`, FLDeleteSpielortResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}
