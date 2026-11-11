import { orMissing } from "@/core/errors";
import { registrierungenGetOpenRegistrierungen, registrierungenGetRegistrierungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLOpenRegistrierungenResponse, FLRegistrierungenAdminListResponse } from "@/core/generated/client/types";

/** Every team's; `null` where no season holds the id. */
export async function getRegistrierungenAdmin(saisonId: string): Promise<FLRegistrierungenAdminListResponse | null> {
  return runAdminRead(() => orMissing(registrierungenGetRegistrierungenAdmin({ saison_id: saisonId })));
}

// A person's read, never `"use cache"`, which keys on the arguments rather than the caller.
export async function getOpenRegistrierungen(teamId: string, saisonId: string): Promise<FLOpenRegistrierungenResponse> {
  return runPersonRead(() => registrierungenGetOpenRegistrierungen(teamId, saisonId));
}
