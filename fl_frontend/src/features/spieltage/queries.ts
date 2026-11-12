import { orMissing } from "@/core/errors";
import { spieltageGetSpieltagAdmin } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpieltagAdminResponse } from "@/core/generated/client/types";

/** A planned season's included; `null` where no matchday holds the id, which the editor answers with its not-found page. */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export async function getAdminSpieltag(spieltagId: string): Promise<FLSpieltagAdminResponse | null> {
  return runAdminRead(() => orMissing(spieltageGetSpieltagAdmin(spieltagId)));
}
