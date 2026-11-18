import { orMissing } from "@/core/errors";
import { spielorteGetSpielort, spielorteGetSpielorte } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpielort, FLSpielorteListResponse, SpielorteGetSpielorteParams } from "@/core/generated/client/types";

/** Admin-tier: the rent is money, and the address parts serve no public page. */
export async function getSpielorte(filters: SpielorteGetSpielorteParams = {}): Promise<FLSpielorteListResponse> {
  return runAdminRead(() => spielorteGetSpielorte(filters));
}

/** Retired or not; `null` where no venue holds the id, which the editor answers with its not-found page. */
export async function getSpielort(spielortId: string): Promise<FLSpielort | null> {
  return runAdminRead(() => orMissing(spielorteGetSpielort(spielortId).then(({ spielort }) => spielort)));
}
