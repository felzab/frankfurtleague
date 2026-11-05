import { isRecordMissing } from "@/core/errors";
import { spielorteGetSpielort, spielorteGetSpielorte } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpielort, FLSpielorteListResponse, SpielorteGetSpielorteParams } from "@/core/generated/client/types";

/**
 * Every venue. Admin-tier: the rent is money (`READ-MONEY-001`), and the address parts serve no
 * public page (`READ-ADDRESS-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSpielorte(filters: SpielorteGetSpielorteParams = {}): Promise<FLSpielorteListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => spielorteGetSpielorte(filters));
}

/**
 * One venue by its id, retired or not, with the `version` its editor's save sends back; `null` where no venue holds
 * the id, which the editor answers with its not-found page. Uncached for the list's reason.
 */
export async function getSpielort(spielortId: string): Promise<FLSpielort | null> {
  return runAdminRead(() =>
    spielorteGetSpielort(spielortId).then(
      ({ spielort }) => spielort,
      (error: unknown) => {
        if (isRecordMissing(error)) return null;
        throw error;
      },
    ),
  );
}
