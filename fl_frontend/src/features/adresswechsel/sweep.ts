import "server-only";

import { ContractBreakError } from "@/core/errors";

import { postAdresswechselSweep } from "./mutations";
import { runAdresswechselUmzuege } from "./umzug";

import type { FLAdresswechselSweepResponse } from "@/core/generated/client/types";

/**
 * Every pending change whose step lapsed, and every one whose waiting time ended, then every account's carry still
 * owed; run in the applications' job (`fl_frontend/src/features/bewerbungen/sweep.ts :: runBewerbungSweep`). A failure
 * rejects, for the heartbeat to name; the pass resolves to what it did, `verbleibend` the lapsed changes it could not end.
 */
export async function sweepAdresswechsel(): Promise<Omit<FLAdresswechselSweepResponse, "nach">> {
  let entfernt = 0;
  let wirksam = 0;
  let verworfen = 0;
  let antwort: FLAdresswechselSweepResponse;
  let nach: string | null = null;
  do {
    antwort = await postAdresswechselSweep(nach);
    entfernt += antwort.entfernt;
    verworfen += antwort.verworfen;
    wirksam += antwort.wirksam;
    // The pass's one end and its guard against a place not past the one sent, as the pupils' deletion's
    // (`fl_frontend/src/features/saisons/loeschung.ts :: sweepLoeschung`).
    if (nach !== null && antwort.nach !== null && antwort.nach <= nach) {
      throw new ContractBreakError("The lapsed addresses answered a place not past the one they were sent.");
    }
    nach = antwort.nach;
  } while (nach !== null);

  // An effect of this pass, or one whose press lost its answer, owes its account's carry.
  await runAdresswechselUmzuege();

  // The last call's count, never a sum: each call counts every lapsed change standing, an earlier page's failures among them.
  return { entfernt: entfernt, wirksam: wirksam, verworfen: verworfen, verbleibend: antwort.verbleibend };
}
