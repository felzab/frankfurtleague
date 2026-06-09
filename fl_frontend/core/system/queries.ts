import { cacheLife, cacheTag } from "next/cache";
import { apiClient } from "../api";
import type { CheckIsLiveReturn, CheckIsReadyReturn, GetSystemInfoReturn } from "./types";

export const checkIsLive = async (): Promise<CheckIsLiveReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system_is_live");

  return apiClient<CheckIsLiveReturn>("/system/is_live", { authType: "system" });
};

export const checkIsReady = async (): Promise<CheckIsReadyReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system_is_ready");
  return apiClient<CheckIsReadyReturn>("/system/is_ready", { authType: "system" });
};

export const getSystemInfo = async (): Promise<GetSystemInfoReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system_info");
  return apiClient<GetSystemInfoReturn>("/system/meta", { authType: "system" });
};
