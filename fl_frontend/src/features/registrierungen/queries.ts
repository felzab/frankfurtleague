import { registrierungenGetOpenRegistrierungen } from "@/core/generated/client/sdk";
import { runPersonRead } from "@/shared/utils/personRead";

import type { FLOpenRegistrierungenResponse } from "@/core/generated/client/types";

export async function getOpenRegistrierungen(teamId: string, saisonId: string): Promise<FLOpenRegistrierungenResponse> {
  return runPersonRead(() => registrierungenGetOpenRegistrierungen(teamId, saisonId));
}
