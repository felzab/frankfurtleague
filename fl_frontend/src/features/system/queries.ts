/**
 * SYSTEM · health and diagnostics
 *
 * Wrappers over the backend's three system endpoints. Cached for minutes rather than days — health is
 * the one thing where a stale answer is worse than no answer.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Each call uses a different `authType`, matching how the backend guards them: `is_live` is
 *     unauthenticated because it is the container healthcheck, the other two need the system key.
 *   • `checkIsReady` and `getSystemInfo` have no callers in the application today. They are kept
 *     deliberately, and the system key stays required at boot as a result. If they are ever removed,
 *     remove the environment declaration WITH them — dropping only the declaration turns a
 *     boot-time failure into a runtime `Bearer undefined`.
 */

import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";

import { CheckIsLiveReturnSchema, CheckIsReadyReturnSchema, GetSystemInfoReturnSchema } from "./schemas";

import type { CheckIsLiveReturn, CheckIsReadyReturn, GetSystemInfoReturn } from "./schemas";

export const checkIsLive = async (): Promise<CheckIsLiveReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system");

  return apiClient<CheckIsLiveReturn>("/system/is_live", CheckIsLiveReturnSchema, { authType: "none" });
};

export const checkIsReady = async (): Promise<CheckIsReadyReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system");
  return apiClient<CheckIsReadyReturn>("/system/is_ready", CheckIsReadyReturnSchema, { authType: "system" });
};

export const getSystemInfo = async (): Promise<GetSystemInfoReturn> => {
  "use cache";

  cacheLife("minutes");
  cacheTag("system");
  // "/system/info", not "/system/meta" -- the latter has never existed on the backend.
  return apiClient<GetSystemInfoReturn>("/system/info", GetSystemInfoReturnSchema, { authType: "system" });
};
