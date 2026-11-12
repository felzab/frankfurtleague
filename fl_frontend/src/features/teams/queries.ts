import { cache } from "react";

import { orMissing } from "@/core/errors";
import { teamsGetTeamOverview, teamsGetTeamsAdmin, teamsGetTeamSaisonAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLGruppenNames,
  FLTeamListState,
  FLTeamOverviewResponse,
  FLTeamsAdminListResponse,
  FLTeamSaisonAdminResponse,
} from "@/core/generated/client/types";

/**
 * `null` where no season holds the id. Each filter is an argument of its own, so one render pass's three readers of the
 * page share the read.
 */
export const getTeamsAdmin = cache(
  async (saisonId: string, state: FLTeamListState | null, gruppe: FLGruppenNames | null): Promise<FLTeamsAdminListResponse | null> =>
    runAdminRead(() =>
      orMissing(
        teamsGetTeamsAdmin({
          saison_id: saisonId,
          ...(state === null ? {} : { state }),
          ...(gruppe === null ? {} : { gruppe }),
        }),
      ),
    ),
);

/** `null` where no club or no season holds the ids. */
export const getTeamSaisonAdmin = cache(async (teamId: string, saisonId: string): Promise<FLTeamSaisonAdminResponse | null> =>
  runAdminRead(() => orMissing(teamsGetTeamSaisonAdmin(teamId, saisonId))),
);

export const getTeamOverview = (teamId: string, saisonId: string): Promise<FLTeamOverviewResponse> =>
  runPersonRead(() => teamsGetTeamOverview(teamId, saisonId));
