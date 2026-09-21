import { apiClient } from "@/core/api";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { FLSperrlisteListResponseSchema } from "./schemas";

import type { FLSperrlisteListResponse } from "./schemas";

/**
 * Every ban, newest first. Admin-tier: a row names the administrator who entered it, which no public
 * page serves.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSperrliste(): Promise<FLSperrlisteListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingTrace(() =>
    apiClient<FLSperrlisteListResponse>("/sperrliste", FLSperrlisteListResponseSchema, {
      authType: "admin",
    }),
  );
}
