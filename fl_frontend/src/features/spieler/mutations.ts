import { apiClient } from "@/core/api";

import {
  FLKaderZeileResponseSchema,
  FLSaisonSpielerResponseSchema,
  FLSpielerAdminSingleResponseSchema,
  FLSpielerErasureResponseSchema,
  FLSpielerSelbstEinwilligungResponseSchema,
} from "./schemas";

import type {
  FLDeleteSpielerPayload,
  FLEraseSpielerPayload,
  FLKaderZeileKeyPayload,
  FLKaderZeileResponse,
  FLPatchKaderZeilePayload,
  FLPatchSaisonSpielerPayload,
  FLPatchSpielerPayload,
  FLPostSaisonSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
  FLSaisonSpielerResponse,
  FLSpielerAdminSingleResponse,
  FLSpielerErasureResponse,
  FLSpielerSelbstEinwilligungPayload,
  FLSpielerSelbstEinwilligungResponse,
} from "./schemas";

// The ids go in the PATH, never the body — a backend payload model that saw one refuses the whole
// body (frontend spec 1.3). No fan-out: squad lists read the name through a `$lookup`.
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

// HARD, where `deleteSpieler` above is soft: the person, every squad row they hold and their values
// in the log all go, in one transaction. Refused until they are retired (`REQ-PURGE-001`).
export async function eraseSpieler({ id }: FLEraseSpielerPayload): Promise<FLSpielerErasureResponse> {
  return apiClient<FLSpielerErasureResponse>(`/spieler/${id}/erasure`, FLSpielerErasureResponseSchema, {
    method: "DELETE",
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

// A seat holder's write rides the admin key under the person lane's actor, which the backend checks
// the seat against: the club stays the stored row's, so the path's team is the address and no field.
export async function patchKaderZeile({ team_id, saison_id, spieler_id, ...body }: FLPatchKaderZeilePayload): Promise<FLKaderZeileResponse> {
  return apiClient<FLKaderZeileResponse>(`/spieler/kader/${team_id}/${saison_id}/${spieler_id}`, FLKaderZeileResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(body),
  });
}

// Soft, as the administrator's own is: the row stays, and only the administrator's reactivate brings it back.
export async function deleteKaderZeile({ team_id, saison_id, spieler_id }: FLKaderZeileKeyPayload): Promise<FLKaderZeileResponse> {
  return apiClient<FLKaderZeileResponse>(`/spieler/kader/${team_id}/${saison_id}/${spieler_id}`, FLKaderZeileResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// The pupil's own press, under the person lane's actor. No id in the path: an address holds at most
// one pupil row, so the signed-in person names the record.
export async function patchSpielerSelbstEinwilligung(
  payload: FLSpielerSelbstEinwilligungPayload,
): Promise<FLSpielerSelbstEinwilligungResponse> {
  return apiClient<FLSpielerSelbstEinwilligungResponse>("/spieler/selbst/einwilligung", FLSpielerSelbstEinwilligungResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}
