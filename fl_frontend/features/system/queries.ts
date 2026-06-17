import { cacheLife, cacheTag } from "next/cache";
import type { CheckIsLiveReturn, CheckIsReadyReturn, GetSystemInfoReturn } from "./types";
import { apiClient } from "@/core/api";

export const checkIsLive = async (): Promise<CheckIsLiveReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system", "system:is_live");

  return apiClient<CheckIsLiveReturn>("/system/is_live", { authType: "system" });
};

export const checkIsReady = async (): Promise<CheckIsReadyReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system", "system:is_ready");
  return apiClient<CheckIsReadyReturn>("/system/is_ready", { authType: "system" });
};

export const getSystemInfo = async (): Promise<GetSystemInfoReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system", "system:info");
  return apiClient<GetSystemInfoReturn>("/system/meta", { authType: "system" });
};
