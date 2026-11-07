import { grantsGetGrants } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLGrantsListResponse } from "@/core/generated/client/types";

/**
 * Every grant, by address, a waiting addition among them.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getGrants(): Promise<FLGrantsListResponse> {
  return runAdminRead(() => grantsGetGrants());
}
