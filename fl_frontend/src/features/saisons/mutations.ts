import { apiClient } from "@/core/api";

import {
  FLActivateSaisonResponseSchema,
  FLGenerateSpielplanResponseSchema,
  FLPatchSaisonResponseSchema,
  FLPostSaisonResponseSchema,
  FLSwapGruppenResponseSchema,
} from "./schemas";

import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLGenerateSpielplanPayload,
  FLGenerateSpielplanResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
} from "./schemas";

// The one create whose payload carries its own id: `saisons._id` is chosen rather than generated, so
// a reuse is refused by the index and comes back as a 409 with no error code on it.
export async function postSaison(payload: FLPostSaisonPayload): Promise<FLPostSaisonResponse> {
  return apiClient<FLPostSaisonResponse>("/saisons", FLPostSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

export async function patchSaison({ id, ...fields }: FLPatchSaisonPayload): Promise<FLPatchSaisonResponse> {
  return apiClient<FLPatchSaisonResponse>(`/saisons/${id}`, FLPatchSaisonResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

/** Promotes this season and demotes the incumbent in one transaction. No body: the id is the whole argument. */
export async function activateSaison({ id }: FLActivateSaisonPayload): Promise<FLActivateSaisonResponse> {
  return apiClient<FLActivateSaisonResponse>(`/saisons/${id}/activate`, FLActivateSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/**
 * Draws the season's matchdays and fixtures in one transaction. **`replace` makes the same call
 * DESTRUCTIVE**: it deletes the rows it replaces, and nothing writes them back. `shape` moves the
 * three shape rules with them. Nothing here retries on a 409.
 */
export async function generateSpielplan({ id, ...confirmation }: FLGenerateSpielplanPayload): Promise<FLGenerateSpielplanResponse> {
  return apiClient<FLGenerateSpielplanResponse>(`/saisons/${id}/spielplan`, FLGenerateSpielplanResponseSchema, {
    method: "POST",
    authType: "admin",
    // `{}` where the caller named no flag, which the endpoint reads as the first draw.
    body: JSON.stringify(confirmation),
  });
}

/**
 * **One request and not two junction PATCHes.** Two calls leave a window in which one group is a club
 * short and the other a club over, permanently so if the second fails. The same transaction rewrites
 * the two clubs' drawn Gruppenphase sides.
 */
export async function swapGruppen({ saison_id, ...teams }: FLSwapGruppenPayload): Promise<FLSwapGruppenResponse> {
  return apiClient<FLSwapGruppenResponse>(`/saisons/${saison_id}/gruppen/swap`, FLSwapGruppenResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(teams),
  });
}
