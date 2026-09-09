import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { FLSchiedsrichterListResponseSchema, FLSchiedsrichterSingleResponseSchema } from "./schemas";

import type { FLSchiedsrichterListResponse, FLSchiedsrichterSingleResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams } from "./types";

/**
 * Every referee, with their contact details, school and fee. Admin-tier: a referee is a pupil
 * (`READ-CONTACT-001`), and the fee is money (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingTrace(() =>
    apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}

/**
 * One referee by id, whatever state they are in — the read a fixture's link to the person who
 * officiated it resolves through, the list above serving what can still be acted on.
 *
 * **Uncached** for the reason the list is.
 */
export async function getSchiedsrichterById(schiedsrichterId: string): Promise<FLSchiedsrichterSingleResponse | null> {
  return runWithIncomingTrace(() =>
    // `null` for "no such referee", which the editor page turns into `notFound()`. Every other
    // status still throws.
    apiClient<FLSchiedsrichterSingleResponse>(`/schiedsrichter/${schiedsrichterId}`, FLSchiedsrichterSingleResponseSchema, {
      authType: "admin",
    }).catch((error: unknown) => {
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
  );
}
