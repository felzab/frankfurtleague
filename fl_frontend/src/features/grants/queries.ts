import { grantsGetGrants } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLGrantsListResponse } from "@/core/generated/client/types";

export async function getGrants(): Promise<FLGrantsListResponse> {
  return runAdminRead(() => grantsGetGrants());
}
