import { apiClient } from "@/core/api";

import { FLSaisonSpielerResponseSchema, FLSpielerAdminSingleResponseSchema, FLSpielerWriteResponseSchema } from "./schemas";

import type {
  FLDeleteSpielerPayload,
  FLPatchSaisonSpielerPayload,
  FLPatchSpielerPayload,
  FLPostSaisonSpielerPayload,
  FLPostSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerAdminSingleResponse,
  FLSpielerWriteResponse,
} from "./schemas";

export async function postSpieler(payload: FLPostSpielerPayload): Promise<FLSpielerWriteResponse> {
  return apiClient<FLSpielerWriteResponse>("/spieler", FLSpielerWriteResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// The ids go in the PATH, never the body — a backend payload model that saw one would drop it
// silently (frontend spec 1.3). No fan-out: squad lists read the name through a `$lookup`.
export async function patchSpieler({ id, ...fields }: FLPatchSpielerPayload): Promise<FLSpielerAdminSingleResponse> {
  return apiClient<FLSpielerAdminSingleResponse>(`/spieler/${id}`, FLSpielerAdminSingleResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft — the backend stamps `inactive_since`; the squad rows are left alone.
export async function deleteSpieler({ id }: FLDeleteSpielerPayload): Promise<FLSpielerAdminSingleResponse> {
  return apiClient<FLSpielerAdminSingleResponse>(`/spieler/${id}`, FLSpielerAdminSingleResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

export async function reactivateSpieler({ id }: FLReactivateSpielerPayload): Promise<FLSpielerAdminSingleResponse> {
  return apiClient<FLSpielerAdminSingleResponse>(`/spieler/${id}/reactivate`, FLSpielerAdminSingleResponseSchema, {
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

// Soft — the row stays as the record that this player wore this number in this squad.
export async function deleteSaisonSpieler({ spieler_id, saison_id }: FLSaisonSpielerKeyPayload): Promise<FLSaisonSpielerResponse> {
  return apiClient<FLSaisonSpielerResponse>(`/spieler/${spieler_id}/saisons/${saison_id}`, FLSaisonSpielerResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// The one way back in: a second create 409s against the index the retired row still holds, and
// reviving inside create would overwrite that row's number, position and stufe.
export async function reactivateSaisonSpieler({ spieler_id, saison_id }: FLSaisonSpielerKeyPayload): Promise<FLSaisonSpielerResponse> {
  return apiClient<FLSaisonSpielerResponse>(`/spieler/${spieler_id}/saisons/${saison_id}/reactivate`, FLSaisonSpielerResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
