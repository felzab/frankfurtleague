import { apiClient } from "@/core/api";
import { runAdminRead } from "@/shared/utils/adminRead";

import { FLBerechtigungenListResponseSchema } from "./schemas";

import type { FLBerechtigungenListResponse } from "./schemas";

/**
 * Every grant, by address. Admin-tier: a row names an administrator's address, which no public page serves.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getBerechtigungen(): Promise<FLBerechtigungenListResponse> {
  return runAdminRead(() =>
    apiClient<FLBerechtigungenListResponse>("/berechtigungen", FLBerechtigungenListResponseSchema, {
      authType: "admin",
    }),
  );
}
