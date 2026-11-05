import { cache } from "react";

import { teamsGetInvitation } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLInvitationResponse } from "@/core/generated/client/types";

/**
 * **Never `"use cache"` here**: `laeuft` is judged against today, so a cached answer would go on
 * reporting an open window long after it shut.
 */
// `cache` memoizes per RENDER PASS.
export const getEinladung = cache(async (teamId: string, saisonId: string): Promise<FLInvitationResponse> =>
  runAdminRead(() => teamsGetInvitation(teamId, saisonId)),
);
