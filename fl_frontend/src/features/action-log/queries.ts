import { actionLogGetActionLog } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLActionLogFilterPayload, FLActionLogListResponse } from "@/core/generated/client/types";

/** Admin-tier: a row names administrators by their addresses. */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getActionLog(filters: FLActionLogFilterPayload): Promise<FLActionLogListResponse> {
  return runAdminRead(() => actionLogGetActionLog(filters));
}
