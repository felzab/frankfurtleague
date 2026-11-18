import { orMissing } from "@/core/errors";
import { registrierungenGetOpenRegistrierungen, registrierungenGetRegistrierungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLOpenRegistrierungenResponse, FLRegistrierungenAdminListResponse } from "@/core/generated/client/types";

/** Every team's; `null` where no season holds the id. */
export async function getRegistrierungenAdmin(saisonId: string): Promise<FLRegistrierungenAdminListResponse | null> {
  return runAdminRead(() => orMissing(registrierungenGetRegistrierungenAdmin({ saison_id: saisonId })));
}

export async function getOpenRegistrierungen(teamId: string, saisonId: string): Promise<FLOpenRegistrierungenResponse> {
  return runPersonRead(() => registrierungenGetOpenRegistrierungen(teamId, saisonId));
}
