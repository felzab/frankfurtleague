import "server-only";

import { getSpielbestaetigungSweepSaisons, postSpielbestaetigungSweep } from "./mutations";

import type { FLSpielbestaetigungSweepResponse } from "@/core/generated/client/types";

/** What a pass did, summed over the seasons it swept. */
type Zaehler = Omit<FLSpielbestaetigungSweepResponse, "saison_id">;

/**
 * One pass over every season the listing answers, for the scheduler (`fl_frontend/src/instrumentation-node.ts ::
 * armScheduler`), whose drain after its jobs sends every mail the pass owed. Rejects where the listing or a season's
 * pass fails, the seasons after it left to the next pass; each season's pass is idempotent. The fixture pages show what
 * it closed within the `minutes` lifetime their cached read keeps. Answers what it did, the rows it passed over owing
 * no deletion.
 */
export async function runSpielSweep(): Promise<{ count: Zaehler; open: number }> {
  const { saison_ids: saisonIds } = await getSpielbestaetigungSweepSaisons();

  const zaehler: Zaehler = { closed: 0, asked: 0, reminded: 0, mails: 0, failed: 0 };
  // Season by season and never in parallel: one slow pass costs nothing, where a fan-out would put every season's
  // writes on the database at once.
  for (const saisonId of saisonIds) {
    const antwort = await postSpielbestaetigungSweep(saisonId);
    zaehler.closed += antwort.closed;
    zaehler.asked += antwort.asked;
    zaehler.reminded += antwort.reminded;
    zaehler.mails += antwort.mails;
    zaehler.failed += antwort.failed;
  }

  return { count: zaehler, open: 0 };
}
