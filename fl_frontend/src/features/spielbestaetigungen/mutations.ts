import { spielbestaetigungenGetSweepSaisons, spielbestaetigungenSweepSpielbestaetigungen } from "@/core/generated/client/sdk";

import type { FLSpielbestaetigungSweepResponse, FLSweepSaisonsResponse } from "@/core/generated/client/types";

/**
 * The seasons the confirmation pass visits. Here rather than in a `queries.ts` because every read there is
 * cached for a render, and this one answers a timer. The system tier, not admin: the timer holds no session, and an
 * invented actor for a machine is what `fl_backend/app/core/recording.py :: SYSTEM_ACTOR` exists to avoid.
 */
export async function getSpielbestaetigungSweepSaisons(): Promise<FLSweepSaisonsResponse> {
  return spielbestaetigungenGetSweepSaisons();
}

/** One season's pass: rows closed, asked and reminded, each mail it owed left in the Postausgang for the drain. */
export async function postSpielbestaetigungSweep(saisonId: string): Promise<FLSpielbestaetigungSweepResponse> {
  return spielbestaetigungenSweepSpielbestaetigungen(saisonId);
}
