import { orMissing } from "@/core/errors";
import { spielerGetKader, spielerGetSpielerAdmin, spielerGetSpielerSaison } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLKaderResponse, FLSpielerAdminListResponse, FLSpielerSaisonAdminResponse } from "@/core/generated/client/types";

/** One season's squad rows for the Spieler list, every team's; `null` where no season holds the id. */
// Never `"use cache"` here, which keys on the arguments rather than the caller.
export async function getSpielerAdmin(saisonId: string): Promise<FLSpielerAdminListResponse | null> {
  return runAdminRead(() => orMissing(spielerGetSpielerAdmin({ saison_id: saisonId })));
}

/** What the Spieler editor shows, in its one read; `null` where the person holds no squad row of that season. */
export async function getSpielerSaison(spielerId: string, saisonId: string): Promise<FLSpielerSaisonAdminResponse | null> {
  return runAdminRead(() => orMissing(spielerGetSpielerSaison(spielerId, saisonId)));
}

/** A team's squad in one season as its seat holder reads it, ausgetragen rows included, with the Stufen an edit may take. */
// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getKader(teamId: string, saisonId: string): Promise<FLKaderResponse> {
  return runPersonRead(() => spielerGetKader(teamId, saisonId));
}
