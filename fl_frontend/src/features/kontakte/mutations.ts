import { apiClient } from "@/core/api";
import { FLBewerbungPersonEinwilligungResponseSchema } from "@/features/bewerbungen/schemas";

import {
  FLKontaktEinladenResponseSchema,
  FLKontaktErasureAnsichtResponseSchema,
  FLKontaktErasureResponseSchema,
  FLPatchSaisonTeamKontakteResponseSchema,
  FLSaisonTeamPersonEinwilligungResponseSchema,
} from "./schemas";

import type { FLBewerbungPersonEinwilligungPayload, FLBewerbungPersonEinwilligungResponse } from "@/features/bewerbungen/schemas";
import type {
  FLKontaktEinladenPayload,
  FLKontaktEinladenResponse,
  FLKontaktErasureAnsichtResponse,
  FLKontaktErasurePayload,
  FLKontaktErasureResponse,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
  FLSaisonTeamPersonEinwilligungPayload,
  FLSaisonTeamPersonEinwilligungResponse,
} from "./schemas";

/**
 * The address travels in the BODY, never in a path or a query: those would file it in the access
 * log, in nginx's log and in `aktionen.request.path` at once. Hence a POST, a DELETE's body having
 * no defined semantics (RFC 9110 §9.3.5).
 */
export async function eraseKontaktperson(payload: FLKontaktErasurePayload): Promise<FLKontaktErasureResponse> {
  return apiClient<FLKontaktErasureResponse>("/kontakte/erasure", FLKontaktErasureResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

/**
 * A POST that reads, for the erasure's own reason above. It takes that write's payload rather than
 * one of its own, so a confirmation cannot be shown for one address and performed for another.
 */
export async function readKontaktErasureAnsicht(payload: FLKontaktErasurePayload): Promise<FLKontaktErasureAnsichtResponse> {
  return apiClient<FLKontaktErasureAnsichtResponse>("/kontakte/erasure/ansicht", FLKontaktErasureAnsichtResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

// Both ids go in the PATH, as every junction write spells them — a backend payload model that saw
// one refuses the whole body (frontend spec 1.3).
export async function patchSaisonTeamKontakte({
  team_id,
  saison_id,
  ...body
}: FLPatchSaisonTeamKontaktePayload): Promise<FLPatchSaisonTeamKontakteResponse> {
  return apiClient<FLPatchSaisonTeamKontakteResponse>(
    `/teams/${team_id}/saisons/${saison_id}/kontakte`,
    FLPatchSaisonTeamKontakteResponseSchema,
    {
      method: "PATCH",
      authType: "admin",
      body: JSON.stringify(body),
    },
  );
}

/**
 * The token is ANSWERED rather than mailed by the backend, as the save's are: every message this app
 * sends is composed here. The seat's earlier link stops opening anything.
 */
export async function einladeKontakt({ team_id, saison_id, rolle }: FLKontaktEinladenPayload): Promise<FLKontaktEinladenResponse> {
  return apiClient<FLKontaktEinladenResponse>(
    `/teams/${team_id}/saisons/${saison_id}/kontakte/${rolle}/bestaetigung/einladen`,
    FLKontaktEinladenResponseSchema,
    {
      method: "POST",
      authType: "admin",
    },
  );
}

// A seat holder's own two choices, under the person lane's actor: the backend moves them on every seat
// of theirs on that row and judges the seat itself, a past season's included for a withdrawal.
export async function patchSitzEinwilligung(
  teamId: string,
  saisonId: string,
  payload: FLSaisonTeamPersonEinwilligungPayload,
): Promise<FLSaisonTeamPersonEinwilligungResponse> {
  return apiClient<FLSaisonTeamPersonEinwilligungResponse>(
    `/teams/${teamId}/saisons/${saisonId}/person/einwilligung`,
    FLSaisonTeamPersonEinwilligungResponseSchema,
    {
      method: "PATCH",
      authType: "admin",
      body: JSON.stringify(payload),
    },
  );
}

// A seat holder's withdrawal on a pending application, under the person lane's actor: the backend moves
// every seat of theirs on it and takes a withdrawal alone, a grant being the confirmation page's.
export async function patchBewerbungEinwilligung(
  bewerbungId: string,
  payload: FLBewerbungPersonEinwilligungPayload,
): Promise<FLBewerbungPersonEinwilligungResponse> {
  return apiClient<FLBewerbungPersonEinwilligungResponse>(
    `/bewerbungen/${bewerbungId}/person/einwilligung`,
    FLBewerbungPersonEinwilligungResponseSchema,
    {
      method: "PATCH",
      authType: "admin",
      body: JSON.stringify(payload),
    },
  );
}
