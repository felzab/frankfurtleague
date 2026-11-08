import { banListGetBanListEntries } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLBanListResponse } from "@/core/generated/client/types";

/**
 * Every ban, newest first. Admin-tier: a row holds the address.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getBanList(): Promise<FLBanListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => banListGetBanListEntries());
}
