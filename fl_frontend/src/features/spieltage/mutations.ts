import { spieltagePatchSpieltag } from "@/core/generated/client/sdk";

import type { FLPatchSpieltagPayload, FLSpieltagWriteResponse } from "@/core/generated/client/types";

// The only write a matchday takes: the season's generator owns which rounds exist and in what order,
// so the dates are all that is left to say.
export async function patchSpieltag({ id, beginn, ende }: FLPatchSpieltagPayload & { id: string }): Promise<FLSpieltagWriteResponse> {
  return spieltagePatchSpieltag(id, { beginn, ende });
}
