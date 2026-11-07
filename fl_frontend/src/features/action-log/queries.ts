import { actionLogGetActionLog } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLActionLogFilterPayload, FLActionLogListResponse } from "@/core/generated/client/types";

/**
 * One page of the Protokoll, newest first. Admin-tier: a row names administrators by their addresses.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getActionLog(filters: FLActionLogFilterPayload): Promise<FLActionLogListResponse> {
  return runAdminRead(() => actionLogGetActionLog(filters));
}
