import { spielerDeleteKaderRow, spielerPatchEinwilligung, spielerPatchKaderRow } from "@/core/generated/client/sdk";

import type { FLAccountEinwilligungPayload, FLPatchKaderRowPayload } from "@/core/generated/client/types";

// The pupil's own press, under the person lane's actor. No id in the path: an address holds at most
// one pupil row, so the signed-in person names the record.
export async function patchSpielerAccountEinwilligung(payload: FLAccountEinwilligungPayload): Promise<void> {
  return spielerPatchEinwilligung(payload);
}

/** A seat holder's edit of a live squad row, on the row's version the page read. */
export async function patchKaderRow(teamId: string, saisonId: string, spielerId: string, row: FLPatchKaderRowPayload): Promise<void> {
  await spielerPatchKaderRow(teamId, saisonId, spielerId, row);
}

/** A seat holder taking a player out of the squad: the row stays, ausgetragen, and only the league brings it back. */
export async function deleteKaderRow(teamId: string, saisonId: string, spielerId: string): Promise<void> {
  await spielerDeleteKaderRow(teamId, saisonId, spielerId);
}
