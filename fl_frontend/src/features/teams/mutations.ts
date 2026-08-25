import { apiClient } from "@/core/api";

import {
  FLPatchTeamResponseSchema,
  FLPostTeamResponseSchema,
  FLReplaceSaisonTeamResponseSchema,
  FLSaisonTeamResponseSchema,
  FLTeamWriteResponseSchema,
} from "./schemas";

import type {
  FLDeleteTeamPayload,
  FLPatchSaisonTeamPayload,
  FLPatchTeamPayload,
  FLPatchTeamResponse,
  FLPostSaisonTeamPayload,
  FLPostTeamPayload,
  FLPostTeamResponse,
  FLReactivateTeamPayload,
  FLReplaceSaisonTeamPayload,
  FLReplaceSaisonTeamResponse,
  FLSaisonTeamResponse,
  FLTeamWriteResponse,
} from "./schemas";

export async function postTeam(postTeamPayload: FLPostTeamPayload): Promise<FLPostTeamResponse> {
  return apiClient<FLPostTeamResponse>("/teams", FLPostTeamResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postTeamPayload),
  });
}

// The id goes in the PATH, never the body — a backend payload model that saw one would drop it
// silently (frontend spec 1.3).
export async function patchTeam({ id, ...fields }: FLPatchTeamPayload): Promise<FLPatchTeamResponse> {
  return apiClient<FLPatchTeamResponse>(`/teams/${id}`, FLPatchTeamResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteTeam({ id }: FLDeleteTeamPayload): Promise<FLTeamWriteResponse> {
  return apiClient<FLTeamWriteResponse>(`/teams/${id}`, FLTeamWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// The one way back: creating never revives, because a shorthand cannot say WHICH club is meant. An id
// can, so reactivation names one and carries no body.
export async function reactivateTeam({ id }: FLReactivateTeamPayload): Promise<FLTeamWriteResponse> {
  return apiClient<FLTeamWriteResponse>(`/teams/${id}/reactivate`, FLTeamWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

// A POST and a PATCH and no DELETE: a team never leaves a season, and disqualification is the only
// way out.
export async function postSaisonTeam({ team_id, ...body }: FLPostSaisonTeamPayload): Promise<FLSaisonTeamResponse> {
  return apiClient<FLSaisonTeamResponse>(`/teams/${team_id}/saisons`, FLSaisonTeamResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(body),
  });
}

export async function patchSaisonTeam({ team_id, saison_id, ...body }: FLPatchSaisonTeamPayload): Promise<FLSaisonTeamResponse> {
  return apiClient<FLSaisonTeamResponse>(`/teams/${team_id}/saisons/${saison_id}`, FLSaisonTeamResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(body),
  });
}

// The row is addressed by its natural key and the club taking it over rides in the body: the path
// names the club going OUT, which is why a phantom row naming no club is repairable through here.
export async function replaceSaisonTeam({ team_id, saison_id, ...body }: FLReplaceSaisonTeamPayload): Promise<FLReplaceSaisonTeamResponse> {
  return apiClient<FLReplaceSaisonTeamResponse>(`/teams/${team_id}/saisons/${saison_id}/replace`, FLReplaceSaisonTeamResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(body),
  });
}
