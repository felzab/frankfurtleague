import { identitySweepErasure } from "@/core/generated/client/sdk";

import type { FLErasureSweepResponse } from "@/core/generated/client/types";

/**
 * The system tier, whoever presses: the season-after rule deletes, never the administrator who activated a
 * season. No season in the call, which reads the statuses itself; `after` is the previous call's answer.
 */
export async function postLoeschungSweep(after: string | null): Promise<FLErasureSweepResponse> {
  // Left out on a pass's first call: the server takes `after` as an id wherever it is present.
  return identitySweepErasure(after === null ? {} : { after });
}
