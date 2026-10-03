import { cache } from "react";

import { apiClient } from "@/core/api";
import { runPersonRead } from "@/shared/utils/personRead";

import { FLTeamSitzeResponseSchema } from "./schemas";

import type { FLTeamSitzeResponse } from "./schemas";

/**
 * The three seats of one team and season, as the landing names them. Never cached: the backend
 * re-derives the reader's own seat on every call, and a cached answer would serve whoever asked first.
 */
export const getTeamSitze = cache(async (teamId: string, saisonId: string): Promise<FLTeamSitzeResponse> =>
  runPersonRead(() =>
    apiClient<FLTeamSitzeResponse>(
      `/teams/${encodeURIComponent(teamId)}/saisons/${encodeURIComponent(saisonId)}/person/sitze`,
      FLTeamSitzeResponseSchema,
      { authType: "admin" },
    ),
  ),
);
