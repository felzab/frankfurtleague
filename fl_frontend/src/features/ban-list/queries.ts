import { banListGetBanListEntries } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLBanListResponse } from "@/core/generated/client/types";

/** Admin-tier: a row holds the address. */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getBanList(): Promise<FLBanListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => banListGetBanListEntries());
}
