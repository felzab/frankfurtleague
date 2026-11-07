import { grantsPostGrantsReconciliation } from "@/core/generated/client/sdk";

import type { FLGrantReconciliationResponse } from "@/core/generated/client/types";

/** The comparison, system tier: it writes, owing a notice of every change made in the database directly. */
export async function postBerechtigungenAbgleich(): Promise<FLGrantReconciliationResponse> {
  return grantsPostGrantsReconciliation();
}
