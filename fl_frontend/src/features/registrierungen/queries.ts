import { orMissing } from "@/core/errors";
import { registrierungenGetRegistrierungenAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLRegistrierungenAdminListResponse } from "@/core/generated/client/types";

/** One season's pending registrations for the Registrierungen list, every team's; `null` where no season holds the id. */
export async function getRegistrierungenAdmin(saisonId: string): Promise<FLRegistrierungenAdminListResponse | null> {
  return runAdminRead(() => orMissing(registrierungenGetRegistrierungenAdmin({ saison_id: saisonId })));
}
