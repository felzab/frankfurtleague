import { apiClient } from "@/core/api";

import { FLEinladungMintResponseSchema, FLEinladungVersandResponseSchema, FLEinladungWriteResponseSchema } from "./schemas";

import type {
  FLEinladungKeyPayload,
  FLEinladungMintResponse,
  FLEinladungVersandPayload,
  FLEinladungVersandResponse,
  FLEinladungWriteResponse,
} from "./schemas";

// Both ids go in the PATH, never the body — a backend payload model that saw one refuses the whole
// body (`docs/frontend/spec.md` §1.3).
/** Mints, revoking any live invite of that team and season in the same transaction, and answers the raw link value once. */
export async function postEinladung({ team_id, saison_id }: FLEinladungKeyPayload): Promise<FLEinladungMintResponse> {
  return apiClient<FLEinladungMintResponse>(`/teams/${team_id}/saisons/${saison_id}/einladung`, FLEinladungMintResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/** Closes the live invite. Soft, as every removal here is: the row keeps its history and stops opening anything. */
export async function deleteEinladung({ team_id, saison_id }: FLEinladungKeyPayload): Promise<FLEinladungWriteResponse> {
  return apiClient<FLEinladungWriteResponse>(`/teams/${team_id}/saisons/${saison_id}/einladung`, FLEinladungWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

/**
 * The SEASON's resource, not a loop over the teams': the unit of work is the season, and a per-team
 * route would be the loop this press exists to remove.
 */
export async function postEinladungVersand({ id, erneut }: FLEinladungVersandPayload): Promise<FLEinladungVersandResponse> {
  return apiClient<FLEinladungVersandResponse>(`/saisons/${id}/einladungen/versand`, FLEinladungVersandResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify({ erneut: erneut }),
  });
}
