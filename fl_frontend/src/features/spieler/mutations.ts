/**
 * SPIELER · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All of these use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The ids go in the PATH and never in the body** (ADR-0034). The payload schemas still carry them,
 * because they back the admin forms and a form has to know which player and which season it is
 * editing — so each mutation below splits them off. A backend payload model that saw one would drop
 * it silently.
 *
 * **Both surfaces have a full soft-delete pair**, unlike the team junction: a squad row really can be
 * retired, because a player leaves a team mid-season, and the way back is `reactivate` rather than a
 * second create — the unique index still holds the key, and reviving inside create would overwrite
 * the number and position the retired row carries (ADR-0032).
 */

import { apiClient } from "@/core/api";

import { FLSaisonSpielerResponseSchema, FLSpielerSingleResponseSchema, FLSpielerWriteResponseSchema } from "./schemas";

import type {
  FLDeleteSpielerPayload,
  FLPatchSaisonSpielerPayload,
  FLPatchSpielerPayload,
  FLPostSaisonSpielerPayload,
  FLPostSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerSingleResponse,
  FLSpielerWriteResponse,
} from "./schemas";

export async function postSpieler(payload: FLPostSpielerPayload): Promise<FLSpielerWriteResponse> {
  return apiClient<FLSpielerWriteResponse>("/spieler", FLSpielerWriteResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// No fan-out, unlike a team rename: a player's name is embedded in no other document, and squad
// lists read it through a `$lookup` at request time.
export async function patchSpieler({ id, ...fields }: FLPatchSpielerPayload): Promise<FLSpielerSingleResponse> {
  return apiClient<FLSpielerSingleResponse>(`/spieler/${id}`, FLSpielerSingleResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing (ADR-0032). Their squad rows are
// left alone — the seasons they played still happened.
export async function deleteSpieler({ id }: FLDeleteSpielerPayload): Promise<FLSpielerSingleResponse> {
  return apiClient<FLSpielerSingleResponse>(`/spieler/${id}`, FLSpielerSingleResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

export async function reactivateSpieler({ id }: FLReactivateSpielerPayload): Promise<FLSpielerSingleResponse> {
  return apiClient<FLSpielerSingleResponse>(`/spieler/${id}/reactivate`, FLSpielerSingleResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

export async function postSaisonSpieler({ spieler_id, ...body }: FLPostSaisonSpielerPayload): Promise<FLSaisonSpielerResponse> {
  return apiClient<FLSaisonSpielerResponse>(`/spieler/${spieler_id}/saisons`, FLSaisonSpielerResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(body),
  });
}

export async function patchSaisonSpieler({ spieler_id, saison_id, ...body }: FLPatchSaisonSpielerPayload): Promise<FLSaisonSpielerResponse> {
  return apiClient<FLSaisonSpielerResponse>(`/spieler/${spieler_id}/saisons/${saison_id}`, FLSaisonSpielerResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(body),
  });
}

// Soft, and the row is what it preserves: it stays as the record that this player was in this squad
// wearing this number, which is still true after they leave.
export async function deleteSaisonSpieler({ spieler_id, saison_id }: FLSaisonSpielerKeyPayload): Promise<FLSaisonSpielerResponse> {
  return apiClient<FLSaisonSpielerResponse>(`/spieler/${spieler_id}/saisons/${saison_id}`, FLSaisonSpielerResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// The one way back into a squad the player already has a row for. A second create is a 409 against
// the index the retired row still holds, and reviving inside create would overwrite the number,
// position and stufe that row carries — which is precisely what is worth keeping (ADR-0032).
export async function reactivateSaisonSpieler({ spieler_id, saison_id }: FLSaisonSpielerKeyPayload): Promise<FLSaisonSpielerResponse> {
  return apiClient<FLSaisonSpielerResponse>(`/spieler/${spieler_id}/saisons/${saison_id}/reactivate`, FLSaisonSpielerResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
