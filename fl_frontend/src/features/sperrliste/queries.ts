import { sperrlisteGetSperrliste } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSperrlisteListResponse } from "@/core/generated/client/types";

/**
 * Every ban, newest first. Admin-tier: a row names the administrator who entered it, which no public
 * page serves.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSperrliste(): Promise<FLSperrlisteListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() => sperrlisteGetSperrliste());
}
