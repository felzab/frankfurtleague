/**
 * SPIELTAGE · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All of these use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The id goes in the PATH and never in the body** (ADR-0027). The patch payload schema still carries
 * one, because it backs the admin form and a form has to know which matchday it is editing, so the
 * mutation splits it off — a backend payload model that saw one would drop it silently.
 *
 * **Deletion is SOFT and has its own way back.** `spiele.spieltag_id` points here and nothing
 * cascades, so a hard delete would leave every one of a matchday's matches referencing nothing
 * (ADR-0025).
 */

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

// No fan-out: matches reference a matchday by id and embed no copy, so a renamed or re-dated matchday
// is picked up on the next read. `saison_id` is not on the payload — moving a matchday between
// seasons would strand its matches, which carry their own.
export async function patchSpieltag({ id, ...fields }: FLPatchSpieltagPayload): Promise<FLSpieltagWriteResponse> {
  return apiClient<FLSpieltagWriteResponse>(`/spieltage/${id}`, FLSpieltagWriteResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft: the backend stamps `inactive_since` and the document stays. Its matches are not touched and
// stay fully readable — `GET /spiele` never joins `spieltage`, which is exactly why this is not a
// delete.
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
