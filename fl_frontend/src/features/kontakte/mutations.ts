import { apiClient } from "@/core/api";
import { FLBewerbungPersonEinwilligungResponseSchema } from "@/features/bewerbungen/schemas";

import {
  FLKontaktEinladenResponseSchema,
  FLPatchSaisonTeamKontakteResponseSchema,
  FLSaisonTeamPersonEinwilligungResponseSchema,
} from "./schemas";

import type { FLBewerbungPersonEinwilligungPayload, FLBewerbungPersonEinwilligungResponse } from "@/features/bewerbungen/schemas";
import type {
  FLKontaktEinladenPayload,
  FLKontaktEinladenResponse,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
  FLSaisonTeamPersonEinwilligungPayload,
  FLSaisonTeamPersonEinwilligungResponse,
} from "./schemas";

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
