import {
  bewerbungenPatchEinwilligung,
  teamsEinladenKontakt,
  teamsPatchEinwilligung,
  teamsPatchSaisonTeamKontakte,
} from "@/core/generated/client/sdk";

import type {
  FLBewerbungKontoEinwilligungResponse,
  FLKontaktEinladenResponse,
  FLKontaktRolle,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
  FLSaisonTeamKontoEinwilligungResponse,
  FLSitzEinwilligungPayload,
} from "@/core/generated/client/types";

// Both ids go in the PATH, as every junction write spells them — a backend payload model that saw
// one refuses the whole body. The body is built from the fields its operation declares.
export async function patchSaisonTeamKontakte({
  team_id,
  saison_id,
  kontakte,
  kontakte_stand,
}: { team_id: string; saison_id: string } & FLPatchSaisonTeamKontaktePayload): Promise<FLPatchSaisonTeamKontakteResponse> {
  return teamsPatchSaisonTeamKontakte(team_id, saison_id, { kontakte: kontakte, kontakte_stand: kontakte_stand });
}

/** The backend owes the link's mail in the write itself; the seat's earlier link stops opening anything. */
export async function einladeKontakt({
  team_id,
  saison_id,
  rolle,
}: {
  team_id: string;
  saison_id: string;
  rolle: FLKontaktRolle;
}): Promise<FLKontaktEinladenResponse> {
  return teamsEinladenKontakt(team_id, saison_id, rolle);
}

// A seat holder's own two choices, under the person lane's actor: the backend moves them on every seat
// of theirs on that row and judges the seat itself, a past season's included for a withdrawal.
export async function patchSitzEinwilligung(
  teamId: string,
  saisonId: string,
  payload: FLSitzEinwilligungPayload,
): Promise<FLSaisonTeamKontoEinwilligungResponse> {
  return teamsPatchEinwilligung(teamId, saisonId, payload);
}

// A seat holder's withdrawal on a pending application, under the person lane's actor: the backend moves
// every seat of theirs on it and takes a withdrawal alone, a grant being the confirmation page's.
export async function patchBewerbungEinwilligung(
  bewerbungId: string,
  payload: FLSitzEinwilligungPayload,
): Promise<FLBewerbungKontoEinwilligungResponse> {
  return bewerbungenPatchEinwilligung(bewerbungId, payload);
}
