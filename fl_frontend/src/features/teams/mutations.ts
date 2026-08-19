/**
 * TEAMS · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All of these use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **The ids go in the PATH and never in the body**. The payload schemas still carry them,
 * because they back the admin forms and a form has to know which club and which season it is
 * editing — so each mutation below splits them off. A backend payload model that saw one would drop
 * it silently.
 *
 * **The junction has a POST and a PATCH and no DELETE**, and none may be added: a team never leaves
 * a season, disqualification is the only way out.
 */

import { apiClient } from "@/core/api";

import { FLPatchTeamResponseSchema, FLPostTeamResponseSchema, FLSaisonTeamResponseSchema, FLTeamWriteResponseSchema } from "./schemas";

import type {
  FLDeleteTeamPayload,
  FLPatchSaisonTeamPayload,
  FLPatchTeamPayload,
  FLPatchTeamResponse,
  FLPostSaisonTeamPayload,
  FLPostTeamPayload,
  FLPostTeamResponse,
  FLReactivateTeamPayload,
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

// The response carries `fanned_out_to_spiele`: the backend rewrites the name and shorthand embedded
// in every match the club plays in, and the count is how that silent half is seen.
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
