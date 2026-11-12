import { registrierungenPatchEinwilligung, registrierungenSweepRegistrierungen } from "@/core/generated/client/sdk";

import type { FLAccountEinwilligungPayload, FLRegistrierungSweepResponse } from "@/core/generated/client/types";

/**
 * One call and not three: the registration gets no pre-notice, so the application flow's mail-stamp-erase ordering has
 * no counterpart, and what this answers is what to mail about work already done.
 */
export async function postRegistrierungSweep(saisonId: string): Promise<FLRegistrierungSweepResponse> {
  return registrierungenSweepRegistrierungen(saisonId);
}

// A pupil's own withdrawal on their pending registration, under the person lane's actor: the backend
// judges the registration theirs and takes a withdrawal alone until the team admits it.
export async function patchRegistrierungEinwilligung(registrierungId: string, payload: FLAccountEinwilligungPayload): Promise<void> {
  return registrierungenPatchEinwilligung(registrierungId, payload);
}
