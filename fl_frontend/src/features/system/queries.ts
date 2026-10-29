import { cacheLife, cacheTag } from "next/cache";

import { systemCheckIsLive } from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import type { CheckIsLiveResponse } from "@/core/generated/client/types";

export const checkIsLive = async (): Promise<CheckIsLiveResponse> => {
  "use cache";

  cacheLife("minutes");
  cacheTag(SITE_CACHE_TAG);

  return systemCheckIsLive();
};
