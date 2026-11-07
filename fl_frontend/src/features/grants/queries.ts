import { addressChangeGetAddressChanges, grantsGetGrants } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLAddressChangeAdminListResponse, FLGrantsListResponse } from "@/core/generated/client/types";

/**
 * Every grant, by address, a waiting addition among them.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getGrants(): Promise<FLGrantsListResponse> {
  return runAdminRead(() => grantsGetGrants());
}

/**
 * The running address changes this administrator may act on, which leaves a holder's to the owner: Administratoren
 * reads what waits among them. Uncached for the grants' reason.
 */
export async function getAddressChanges(): Promise<FLAddressChangeAdminListResponse> {
  return runAdminRead(() => addressChangeGetAddressChanges());
}
