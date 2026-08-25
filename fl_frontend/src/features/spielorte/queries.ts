import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpielorteListResponseSchema } from "./schemas";

import type { FLSpielorteListResponse } from "./schemas";
import type { FLSpielorteFilterParams } from "./types";

/**
 * Every venue. Admin-tier: the rent is money (`READ-MONEY-001`), and the address parts serve no
 * public page (`READ-ADDRESS-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSpielorte(filters: FLSpielorteFilterParams = {}): Promise<FLSpielorteListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingCorrelationId(() =>
    apiClient<FLSpielorteListResponse>("/spielorte", FLSpielorteListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}
