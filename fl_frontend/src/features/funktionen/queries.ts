import { cache } from "react";

import { teamsGetTeamSeats } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLTeamSeatsResponse } from "@/core/generated/client/types";

/**
 * The three seats of one team and season, as the landing names them. Never cached: the backend
 * re-derives the reader's own seat on every call, and a cached answer would serve whoever asked first.
 */
export const getTeamSitze = cache(async (teamId: string, saisonId: string): Promise<FLTeamSeatsResponse> =>
  runPersonRead(() => teamsGetTeamSeats(teamId, saisonId)),
);
