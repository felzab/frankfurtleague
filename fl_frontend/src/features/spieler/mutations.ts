import { spielerPatchEinwilligung } from "@/core/generated/client/sdk";

import type { FLAccountEinwilligungPayload } from "@/core/generated/client/types";

// The pupil's own press, under the person lane's actor. No id in the path: an address holds at most
// one pupil row, so the signed-in person names the record.
export async function patchSpielerAccountEinwilligung(payload: FLAccountEinwilligungPayload): Promise<void> {
  return spielerPatchEinwilligung(payload);
}
