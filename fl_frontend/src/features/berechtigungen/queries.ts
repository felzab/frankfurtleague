import { grantsGetGrants } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLGrantsListResponse } from "@/core/generated/client/types";

/**
 * Every grant, by address. Admin-tier: a row names an administrator's address, which no public page serves.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getBerechtigungen(): Promise<FLGrantsListResponse> {
  return runAdminRead(() => grantsGetGrants());
}
