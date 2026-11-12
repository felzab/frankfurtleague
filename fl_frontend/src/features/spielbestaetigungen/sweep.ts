import "server-only";

import { spielbestaetigungenGetSweepSaisons, spielbestaetigungenSweepSpielbestaetigungen } from "@/core/generated/client/sdk";

import type { FLSpielbestaetigungSweepResponse } from "@/core/generated/client/types";

/** What a pass did, summed over the seasons it swept. */
type Count = Omit<FLSpielbestaetigungSweepResponse, "saison_id">;

/**
 * One pass over every season the listing answers. The scheduler's drain after its jobs sends every mail the pass owed.
 * Rejects where the listing or a season's pass fails, the seasons after it left to the next pass; each season's pass is
 * idempotent. The fixture pages show what it closed within the `minutes` lifetime their cached read keeps. Answers what
 * it did, the rows it passed over owing no deletion.
 */
export async function runSpielSweep(): Promise<{ count: Count; open: number }> {
  const { saison_ids: saisonIds } = await spielbestaetigungenGetSweepSaisons();

  const count: Count = { closed: 0, asked: 0, reminded: 0, mails: 0, failed: 0 };
  // Season by season and never in parallel: one slow pass costs nothing, where a fan-out would put every season's
  // writes on the database at once.
  for (const saisonId of saisonIds) {
    const response = await spielbestaetigungenSweepSpielbestaetigungen(saisonId);
    count.closed += response.closed;
    count.asked += response.asked;
    count.reminded += response.reminded;
    count.mails += response.mails;
    count.failed += response.failed;
  }

  return { count, open: 0 };
}
