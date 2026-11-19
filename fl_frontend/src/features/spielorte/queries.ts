import { orMissing } from "@/core/errors";
import { spielorteGetSpielort, spielorteGetSpielorte } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpielort, FLSpielorteListResponse } from "@/core/generated/client/types";

/** Admin-tier: the rent is money, and the address parts serve no public page. Every venue, the retired ones included. */
export async function getSpielorte(): Promise<FLSpielorteListResponse> {
  return runAdminRead(() => spielorteGetSpielorte());
}

/** Retired or not; `null` where no venue holds the id, which the editor answers with its not-found page. */
export async function getSpielort(spielortId: string): Promise<FLSpielort | null> {
  return runAdminRead(() => orMissing(spielorteGetSpielort(spielortId).then(({ spielort }) => spielort)));
}
