import {
  spielerDeleteKaderZeile,
  spielerDeleteSaisonSpieler,
  spielerDeleteSpieler,
  spielerPatchEinwilligung,
  spielerPatchKaderZeile,
  spielerPatchSaisonSpieler,
  spielerPatchSpieler,
  spielerPostSaisonSpieler,
  spielerReactivateSaisonSpieler,
  spielerReactivateSpieler,
} from "@/core/generated/client/sdk";

import type {
  FLKaderZeile,
  FLKontoEinwilligungPayload,
  FLSaisonSpielerResponse,
  FLSpielerAdminSingleResponse,
  FLSpielerKontoEinwilligungResponse,
} from "@/core/generated/client/types";
import type {
  FLDeleteSpielerPayload,
  FLKaderZeileKeyPayload,
  FLPatchKaderZeilePayload,
  FLPatchSaisonSpielerPayload,
  FLPatchSpielerPayload,
  FLPostSaisonSpielerPayload,
  FLReactivateSpielerPayload,
  FLSaisonSpielerKeyPayload,
} from "./schemas";

// The ids go in the PATH, never the body — a backend payload model that saw one refuses the whole
// body. No fan-out: squad lists read the name through a `$lookup`.
export async function patchSpieler({ id, ...fields }: FLPatchSpielerPayload): Promise<FLSpielerAdminSingleResponse> {
  return spielerPatchSpieler(id, fields);
}

// Soft — the backend stamps `inactive_since`; the squad rows are left alone.
export async function deleteSpieler({ id }: FLDeleteSpielerPayload): Promise<FLSpielerAdminSingleResponse> {
  return spielerDeleteSpieler(id);
}

export async function reactivateSpieler({ id }: FLReactivateSpielerPayload): Promise<FLSpielerAdminSingleResponse> {
  return spielerReactivateSpieler(id);
}

export async function postSaisonSpieler({ spieler_id, ...body }: FLPostSaisonSpielerPayload): Promise<FLSaisonSpielerResponse> {
  return spielerPostSaisonSpieler(spieler_id, body);
}

export async function patchSaisonSpieler({ spieler_id, saison_id, ...body }: FLPatchSaisonSpielerPayload): Promise<FLSaisonSpielerResponse> {
  return spielerPatchSaisonSpieler(spieler_id, saison_id, body);
}

// Soft — the row stays as the record that this player wore this number in this squad.
export async function deleteSaisonSpieler({ spieler_id, saison_id }: FLSaisonSpielerKeyPayload): Promise<FLSaisonSpielerResponse> {
  return spielerDeleteSaisonSpieler(spieler_id, saison_id);
}

// The one way back in: a second create 409s against the index the retired row still holds, and
// reviving inside create would overwrite that row's number, position and stufe.
export async function reactivateSaisonSpieler({ spieler_id, saison_id }: FLSaisonSpielerKeyPayload): Promise<FLSaisonSpielerResponse> {
  return spielerReactivateSaisonSpieler(spieler_id, saison_id);
}

// A seat holder's write rides the admin key under the person lane's actor, which the backend checks
// the seat against: the club stays the stored row's, so the path's team is the address and no field.
export async function patchKaderZeile({ team_id, saison_id, spieler_id, ...body }: FLPatchKaderZeilePayload): Promise<FLKaderZeile> {
  return spielerPatchKaderZeile(team_id, saison_id, spieler_id, body);
}

// Soft, as the administrator's own is: the row stays, and only the administrator's reactivate brings it back.
export async function deleteKaderZeile({ team_id, saison_id, spieler_id }: FLKaderZeileKeyPayload): Promise<FLKaderZeile> {
  return spielerDeleteKaderZeile(team_id, saison_id, spieler_id);
}

// The pupil's own press, under the person lane's actor. No id in the path: an address holds at most
// one pupil row, so the signed-in person names the record.
export async function patchSpielerKontoEinwilligung(payload: FLKontoEinwilligungPayload): Promise<FLSpielerKontoEinwilligungResponse> {
  return spielerPatchEinwilligung(payload);
}
