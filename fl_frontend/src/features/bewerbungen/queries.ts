import { cache } from "react";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLBewerbungenListResponseSchema, FLBewerbungSingleResponseSchema } from "./schemas";

import type { FLBewerbungenListResponse, FLBewerbungSingleResponse } from "./schemas";
import type { FLBewerbungenFilterParams } from "./types";

/**
 * Every application, newest first, narrowable by season and by status.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a
 * cached read of this admin-tier personal data is a shared slot.
 */
export async function getBewerbungen(filters: FLBewerbungenFilterParams = {}): Promise<FLBewerbungenListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingCorrelationId(() =>
    apiClient<FLBewerbungenListResponse>("/bewerbungen", FLBewerbungenListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}

/**
 * The one application the triage page decides against, uncached for the reason above. `null` on a
 * 404, which the page turns into `notFound()`; everything else throws.
 */
// React's `cache` memoizes per RENDER PASS, never across requests -- unlike `"use cache"`, whose key
// is the arguments, not the caller. One pass, one round trip.
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runWithIncomingCorrelationId(() =>
    apiClient<FLBewerbungSingleResponse>(`/bewerbungen/${bewerbungId}`, FLBewerbungSingleResponseSchema, { authType: "admin" }).catch(
      (error: unknown) => {
        if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
        throw error;
      },
    ),
  ),
);
