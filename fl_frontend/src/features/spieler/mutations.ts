import { spielerDeleteKaderRow, spielerPatchEinwilligung, spielerPatchKaderRow } from "@/core/generated/client/sdk";

import type { FLAccountEinwilligungPayload, FLKaderRow } from "@/core/generated/client/types";
import type { FLKaderZeileKeyPayload, FLPatchKaderRowPayload } from "./schemas";

// A seat holder's write rides the admin key under the person lane's actor, which the backend checks
// the seat against: the club stays the stored row's, so the path's team is the address and no field.
export async function patchKaderZeile({ team_id, saison_id, spieler_id, ...body }: FLPatchKaderRowPayload): Promise<FLKaderRow> {
  return spielerPatchKaderRow(team_id, saison_id, spieler_id, body);
}

// Soft, as the administrator's own is: the row stays, and only the administrator's reactivate brings it back.
export async function deleteKaderZeile({ team_id, saison_id, spieler_id }: FLKaderZeileKeyPayload): Promise<FLKaderRow> {
  return spielerDeleteKaderRow(team_id, saison_id, spieler_id);
}

// The pupil's own press, under the person lane's actor. No id in the path: an address holds at most
// one pupil row, so the signed-in person names the record.
export async function patchSpielerKontoEinwilligung(payload: FLAccountEinwilligungPayload): Promise<void> {
  return spielerPatchEinwilligung(payload);
}
