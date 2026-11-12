import { orMissing } from "@/core/errors";
import { spielerGetKader, spielerGetSelfSaison, spielerGetSpielerAdmin, spielerGetSpielerSaison } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type {
  FLKaderResponse,
  FLSpielerAdminListResponse,
  FLSpielerSaisonAdminResponse,
  FLSpielerSaisonSelfResponse,
} from "@/core/generated/client/types";

/** The page has judged the season first. */
// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getSpielerSaisonSelf(saisonId: string): Promise<FLSpielerSaisonSelfResponse> {
  return runPersonRead(() => spielerGetSelfSaison(saisonId));
}

/** Every team's; `null` where no season holds the id. */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getSpielerAdmin(saisonId: string): Promise<FLSpielerAdminListResponse | null> {
  return runAdminRead(() => orMissing(spielerGetSpielerAdmin({ saison_id: saisonId })));
}

/** `null` where the person holds no squad row of that season. */
export async function getSpielerSaison(spielerId: string, saisonId: string): Promise<FLSpielerSaisonAdminResponse | null> {
  return runAdminRead(() => orMissing(spielerGetSpielerSaison(spielerId, saisonId)));
}

/** Ausgetragen rows included, with the Stufen an edit may take. */
// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getKader(teamId: string, saisonId: string): Promise<FLKaderResponse> {
  return runPersonRead(() => spielerGetKader(teamId, saisonId));
}
