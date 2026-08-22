import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSchiedsrichterListResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

/**
 * Every referee, with their contact details, school and fee. Admin-tier: a referee is a pupil
 * (`READ-CONTACT-001`), and the fee is money (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingCorrelationId(() =>
    apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}
