import { schiedsrichterPatchEinwilligung } from "@/core/generated/client/sdk";

import type { FLSchiedsrichterAccountEinwilligungPayload } from "@/core/generated/client/types";

// The referee's own press on the account page, under the person lane's actor; the record is named in
// the path because one address may hold several referee rows.
export async function patchSchiedsrichterKontoEinwilligung(
  schiedsrichterId: string,
  payload: FLSchiedsrichterAccountEinwilligungPayload,
): Promise<void> {
  return schiedsrichterPatchEinwilligung(schiedsrichterId, payload);
}
