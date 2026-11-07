import { grantsPostHandoverPass } from "@/core/generated/client/sdk";

import type { FLGrantHandoverPassResponse } from "@/core/generated/client/types";

/** The handover pass, system tier: it writes, moving the owner role where a wait has ended. */
export async function postHandoverPass(): Promise<FLGrantHandoverPassResponse> {
  return grantsPostHandoverPass();
}
