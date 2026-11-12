import { grantsGetGrants } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLGrantsListResponse } from "@/core/generated/client/types";

// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getGrants(): Promise<FLGrantsListResponse> {
  return runAdminRead(() => grantsGetGrants());
}
