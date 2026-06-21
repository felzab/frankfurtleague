import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { CheckIsLiveReturnSchema, CheckIsReadyReturnSchema, GetSystemInfoReturnSchema } from "./schemas";

import type { CheckIsLiveReturn, CheckIsReadyReturn, GetSystemInfoReturn } from "./schemas";

export const checkIsLive = async (): Promise<CheckIsLiveReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system", "system:is_live");

  return apiClient<CheckIsLiveReturn>("/system/is_live", CheckIsLiveReturnSchema, { authType: "system" });
};

export const checkIsReady = async (): Promise<CheckIsReadyReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system", "system:is_ready");
  return apiClient<CheckIsReadyReturn>("/system/is_ready", CheckIsReadyReturnSchema, { authType: "system" });
};

export const getSystemInfo = async (): Promise<GetSystemInfoReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system", "system:info");
  return apiClient<GetSystemInfoReturn>("/system/meta", GetSystemInfoReturnSchema, { authType: "system" });
};
