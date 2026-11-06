import { bewerbungenPatchEinwilligung, teamsPatchEinwilligung } from "@/core/generated/client/sdk";

import type { FLSeatEinwilligungPayload } from "@/core/generated/client/types";

// A seat holder's own two choices, under the person lane's actor: the backend moves them on every seat
// of theirs on that row and judges the seat itself, a past season's included for a withdrawal.
export async function patchSeatEinwilligung(teamId: string, saisonId: string, payload: FLSeatEinwilligungPayload): Promise<void> {
  return teamsPatchEinwilligung(teamId, saisonId, payload);
}

// A seat holder's withdrawal on a pending application, under the person lane's actor: the backend moves
// every seat of theirs on it and takes a withdrawal alone, a grant being the confirmation page's.
export async function patchBewerbungEinwilligung(bewerbungId: string, payload: FLSeatEinwilligungPayload): Promise<void> {
  return bewerbungenPatchEinwilligung(bewerbungId, payload);
}
