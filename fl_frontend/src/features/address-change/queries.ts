import { addressChangeGetAddressChanges } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLAddressChangeAdminListResponse } from "@/core/generated/client/types";

/**
 * The running changes this administrator may act on, newest first, a change the server denies them left out rather than
 * refused.
 */
export async function getAddressChanges(): Promise<FLAddressChangeAdminListResponse> {
  return runAdminRead(() => addressChangeGetAddressChanges());
}
