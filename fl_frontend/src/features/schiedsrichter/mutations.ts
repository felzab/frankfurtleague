import { schiedsrichterPatchEinwilligung, schiedsrichterSweepSchiedsrichter } from "@/core/generated/client/sdk";

import type { FLSchiedsrichterAccountEinwilligungPayload, FLSchiedsrichterSweepResponse } from "@/core/generated/client/types";

// The referee's own press on the account page, under the person lane's actor; the record is named in
// the path because one address may hold several referee rows.
export async function patchSchiedsrichterAccountEinwilligung(
  schiedsrichterId: string,
  payload: FLSchiedsrichterAccountEinwilligungPayload,
): Promise<void> {
  return schiedsrichterPatchEinwilligung(schiedsrichterId, payload);
}

/** A timer holds no session, and an entry whose link lapsed unanswered or declined is the clock's. */
export async function postSchiedsrichterSweep(): Promise<FLSchiedsrichterSweepResponse> {
  return schiedsrichterSweepSchiedsrichter();
}
