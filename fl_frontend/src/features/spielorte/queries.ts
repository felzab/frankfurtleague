import { spielorteGetSpielorte } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpielorteListResponse, SpielorteGetSpielorteParams } from "@/core/generated/client/types";

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
