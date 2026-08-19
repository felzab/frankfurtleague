/**
 * SAISONS · backend write calls
 *
 * Transport only. Authorization and cache invalidation belong to `actions.ts`, which is the sole
 * caller — a mutation invoked from anywhere else would bypass both.
 *
 * All of these use `authType: "admin"`; the backend's admin router rejects the base key.
 *
 * **Four writes and no delete.** A season that is over is `past`: deleting one would orphan every
 * spiel, spieltag and junction row carrying its id, none of which cascades. There is no
 * `patchSaisonStatus` either, and there cannot be — `activateSaison` is the only path to `active`.
 *
 * **The id goes in the PATH and never in the body**, except on the create, where the id IS
 * the document key and the backend's own payload carries it.
 */

import { apiClient } from "@/core/api";

import {
  FLActivateSaisonResponseSchema,
  FLPatchSaisonResponseSchema,
  FLPostSaisonResponseSchema,
  FLSwapGruppenResponseSchema,
} from "./schemas";

import type {
  FLActivateSaisonPayload,
  FLActivateSaisonResponse,
  FLPatchSaisonPayload,
  FLPatchSaisonResponse,
  FLPostSaisonPayload,
  FLPostSaisonResponse,
  FLSwapGruppenPayload,
  FLSwapGruppenResponse,
} from "./schemas";

// The one create whose payload carries its own id: `saisons._id` is the four-character string every
// `saison_id` elsewhere references, so it is chosen rather than generated. Reusing one is refused by
// the `_id` index and comes back as a 409.
export async function postSaison(payload: FLPostSaisonPayload): Promise<FLPostSaisonResponse> {
  return apiClient<FLPostSaisonResponse>("/saisons", FLPostSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// Editing `rules.win_points` or `draw_points` changes every league table for this season on the next
// read: the standings are derived from the matches rather than stored, so there is no
// migration to run.
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
 * No request body at all — the id is the whole argument. The endpoint refuses the rollover while the
 * outgoing season has unplayed fixtures (`REQ-ACTIVATE-001`), which `activateSaisonAction` maps to a
 * message rather than an error page.
 */
export async function activateSaison({ id }: FLActivateSaisonPayload): Promise<FLActivateSaisonResponse> {
  return apiClient<FLActivateSaisonResponse>(`/saisons/${id}/activate`, FLActivateSaisonResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/**
 * The group swap: two clubs of this season exchange groups, in one transaction on the backend.
 *
 * **One request and not two junction PATCHes**. Two calls have a window in which one group is
 * a club short and the other a club over, and a failure after the first leaves the season in that state
 * permanently. The same transaction also rewrites the two clubs' drawn Gruppenphase sides, which is
 * further out of reach of a client still.
 *
 * Five refusals, each mapped to its own message by `swapGruppenAction`: a pair that is not a swap
 * (`REQ-SWAP-001`), a `past` season (`REQ-SWAP-003`), a knockout round already under way
 * (`REQ-SWAP-002`), either club having played inside its group (`REQ-SWAP-004`), and an exchange that
 * would leave a club standing in two matches of one Spieltag (`REQ-SWAP-005`).
 */
export async function swapGruppen({ saison_id, ...teams }: FLSwapGruppenPayload): Promise<FLSwapGruppenResponse> {
  return apiClient<FLSwapGruppenResponse>(`/saisons/${saison_id}/gruppen/swap`, FLSwapGruppenResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(teams),
  });
}
