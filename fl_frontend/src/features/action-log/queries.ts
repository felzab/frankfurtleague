import { actionLogGetActionLog, actionLogGetActionLogByOptions } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLActionLogByOptionsResponse, FLActionLogFilterPayload, FLActionLogListResponse } from "@/core/generated/client/types";

/** Admin-tier: a row names administrators by their addresses. */
export async function getActionLog(filters: FLActionLogFilterPayload): Promise<FLActionLogListResponse> {
  return runAdminRead(() => actionLogGetActionLog(filters));
}

/** Admin-tier: the „Wer“ filter's options are addresses. */
export async function getActionLogByOptions(): Promise<FLActionLogByOptionsResponse> {
  return runAdminRead(() => actionLogGetActionLogByOptions());
}
