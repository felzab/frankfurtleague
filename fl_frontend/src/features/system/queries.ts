import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import { CheckIsLiveReturnSchema, CheckIsReadyReturnSchema, GetSystemInfoReturnSchema } from "./schemas";

import type { CheckIsLiveReturn, CheckIsReadyReturn, GetSystemInfoReturn } from "./schemas";

export const checkIsLive = async (): Promise<CheckIsLiveReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag(SITE_CACHE_TAG);

  return apiClient<CheckIsLiveReturn>("/system/is_live", CheckIsLiveReturnSchema, {
    authType: "none",
  });
};

/**
 * Kept uncalled deliberately. Removing this or `getSystemInfo` means removing the system-key
 * environment declaration with it.
 */
export const checkIsReady = async (): Promise<CheckIsReadyReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag(SITE_CACHE_TAG);
  return apiClient<CheckIsReadyReturn>("/system/is_ready", CheckIsReadyReturnSchema, {
    authType: "system",
  });
};

export const getSystemInfo = async (): Promise<GetSystemInfoReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag(SITE_CACHE_TAG);
  // "/system/info", never "/system/meta": the backend serves no such route.
  return apiClient<GetSystemInfoReturn>("/system/info", GetSystemInfoReturnSchema, {
    authType: "system",
  });
};
