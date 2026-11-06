import { cache } from "react";

import { orMissing } from "@/core/errors";
import { spielerGetKader, spielerGetSelf, spielerGetSpielerAdmin, spielerGetSpielerSaison } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLKaderResponse,
  FLSpielerAdminListResponse,
  FLSpielerSaisonAdminResponse,
  FLSpielerSelfResponse,
} from "@/core/generated/client/types";

/** One season's squad rows for the Spieler list, every team's; `null` where no season holds the id. */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export async function getSpielerAdmin(saisonId: string): Promise<FLSpielerAdminListResponse | null> {
  return runAdminRead(() => orMissing(spielerGetSpielerAdmin({ saison_id: saisonId })));
}

/** What the Spieler editor shows, in its one read; `null` where the person holds no squad row of that season. */
export async function getSpielerSaison(spielerId: string, saisonId: string): Promise<FLSpielerSaisonAdminResponse | null> {
  return runAdminRead(() => orMissing(spielerGetSpielerSaison(spielerId, saisonId)));
}

/**
 * One team's squad as its seat holder reads it, refused `role_not_held` where the backend does not
 * find the seat the page's own check found.
 */
// Never `"use cache"`, for `getSpielerAdmin`'s reason: what it answers is the reading person's.
export const getKader = cache(async (teamId: string, saisonId: string): Promise<FLKaderResponse> =>
  runPersonRead(() => spielerGetKader(teamId, saisonId)),
);

/**
 * The signed-in pupil's own record, refused `role_not_held` where the backend holds no confirmed
 * pupil row for the address the page's own check passed.
 */
// Never `"use cache"`, for `getSpielerAdmin`'s reason: what it answers is the reading person's.
export const getSpielerSelf = cache(async (): Promise<FLSpielerSelfResponse> => runPersonRead(() => spielerGetSelf()));
