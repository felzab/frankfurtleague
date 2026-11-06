import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import { teamsGetTeamsAdmin, teamsGetTeamSaisonAdmin, teamsGetTeamSaisons } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLGruppenNames,
  FLTeamListState,
  FLTeamsAdminListResponse,
  FLTeamSaisonAdminResponse,
  FLTeamsSaisonsResponse,
} from "@/core/generated/client/types";

/** A read of one season's record: `null` where the backend answers that it holds none, which the page says as not found. */
const orMissing = <Read>(read: Promise<Read>): Promise<Read | null> =>
  read.catch((error: unknown) => {
    if (isRecordMissing(error)) return null;
    throw error;
  });

/**
 * One season's Teams list and what its create dialog offers, `null` where no season holds the id. Each filter is an
 * argument of its own, so one render pass's three readers of the page share the read.
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

/** What the team editor shows in its one read, `null` where no club or no season holds the ids. */
export const getTeamSaisonAdmin = cache(async (teamId: string, saisonId: string): Promise<FLTeamSaisonAdminResponse | null> =>
  runAdminRead(() => orMissing(teamsGetTeamSaisonAdmin(teamId, saisonId))),
);

/**
 * Every team with every membership, for the admin surfaces — the season-scoped reads cannot answer a
 * club-centric question.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export const getTeamSaisons = cache(async (): Promise<FLTeamsSaisonsResponse> => runAdminRead(() => teamsGetTeamSaisons()));
