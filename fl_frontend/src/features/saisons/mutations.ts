/**
 * SAISONS · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All of these use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **Three writes and no delete.** A season that is over is `past`: deleting one would orphan every
 * spiel, spieltag and junction row carrying its id, none of which cascades (ADR-0033). There is no
 * `patchSaisonStatus` either, and there cannot be — `activateSaison` is the only path to `active`.
 *
 * **The id goes in the PATH and never in the body** (ADR-0034), except on the create, where the id IS
 * the document key and the backend's own payload carries it.
 */

import { apiClient } from "@/core/api";

import { FLActivateSaisonResponseSchema, FLPatchSaisonResponseSchema, FLPostSaisonResponseSchema } from "./schemas";

import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
} from "./schemas";

// The one create in the app whose payload carries its own id: `saisons._id` is the four-character
// string every `saison_id` elsewhere references, so it is chosen rather than generated. Reusing an
// existing one is refused by the `_id` index and comes back as a 409.
export async function postSaison(payload: FLPostSaisonPayload): Promise<FLPostSaisonResponse> {
  return apiClient<FLPostSaisonResponse>("/saisons", FLPostSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// Editing `rules.win_points` or `draw_points` changes every league table for this season on the next
// read: the standings are derived from the matches rather than stored (ADR-0026), so there is no
// migration to run and equally nothing to announce that the numbers moved.
export async function patchSaison({ id, ...fields }: FLPatchSaisonPayload): Promise<FLPatchSaisonResponse> {
  return apiClient<FLPatchSaisonResponse>(`/saisons/${id}`, FLPatchSaisonResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

/**
 * The rollover: promote this season and demote whichever one currently holds `active`, in one
 * transaction on the backend.
 *
 * No request body at all — the id is the whole argument. It carries no "have all the games finished"
 * guard on purpose (ADR-0033): an early rollover is a legitimate decision, and the page is where the
 * precondition is presented to a person who can overrule it.
 */
export async function activateSaison({ id }: FLActivateSaisonPayload): Promise<FLActivateSaisonResponse> {
  return apiClient<FLActivateSaisonResponse>(`/saisons/${id}/activate`, FLActivateSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
