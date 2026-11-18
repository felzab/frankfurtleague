import { banListGetBanListEntries } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLBanListResponse } from "@/core/generated/client/types";

/** Admin-tier: a row holds the address. */
export async function getBanList(): Promise<FLBanListResponse> {
  return runAdminRead(() => banListGetBanListEntries());
}
