import { cache } from "react";

import { teamsGetTeamSaisons } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLTeamsSaisonsResponse } from "@/core/generated/client/types";

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export const getTeamSaisons = cache(async (): Promise<FLTeamsSaisonsResponse> => runAdminRead(() => teamsGetTeamSaisons()));
