import { orMissing } from "@/core/errors";
import { registrierungenGetOpenRegistrierungen, registrierungenGetRegistrierungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLOpenRegistrierungenResponse, FLRegistrierungenAdminListResponse } from "@/core/generated/client/types";

/** One season's pending registrations for the Registrierungen list, every team's; `null` where no season holds the id. */
export async function getRegistrierungenAdmin(saisonId: string): Promise<FLRegistrierungenAdminListResponse | null> {
  return runAdminRead(() => orMissing(registrierungenGetRegistrierungenAdmin({ saison_id: saisonId })));
}

/** One team's pending registrations in one season, newest first, as its seat holder decides them. */
// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getOpenRegistrierungen(teamId: string, saisonId: string): Promise<FLOpenRegistrierungenResponse> {
  return runPersonRead(() => registrierungenGetOpenRegistrierungen(teamId, saisonId));
}
