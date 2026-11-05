import { identitySweepErasure, saisonsSwapGruppen } from "@/core/generated/client/sdk";

import type { FLErasureSweepResponse, FLSwapGruppenPayload, FLSwapGruppenResponse } from "@/core/generated/client/types";

// Session 6: goes with the old team editor, the group swap's last old caller.
/**
 * **One request and not two junction PATCHes.** Two calls leave a window in which one group is a club
 * short and the other a club over, permanently so if the second fails. The same transaction rewrites
 * the two clubs' drawn Gruppenphase sides.
 */
export async function swapGruppen({
  saison_id,
  team1_id,
  team2_id,
}: FLSwapGruppenPayload & { saison_id: string }): Promise<FLSwapGruppenResponse> {
  return saisonsSwapGruppen(saison_id, { team1_id, team2_id });
}

/**
 * The system tier, whoever presses: the season-after rule deletes, never the administrator who activated a
 * season. No season in the call, which reads the statuses itself; `after` is the previous call's answer.
 */
export async function postLoeschungSweep(after: string | null): Promise<FLErasureSweepResponse> {
  // Left out on a pass's first call: the server takes `after` as an id wherever it is present.
  return identitySweepErasure(after === null ? {} : { after: after });
}
