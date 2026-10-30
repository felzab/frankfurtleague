import "server-only";

import { logger } from "@/core/logging";

import { getSpielbestaetigungSweepSaisons, postSpielbestaetigungSweep } from "./mutations";

import type { FLSpielbestaetigungSweepResponse } from "@/core/generated/client/types";

/** What a pass did, summed over the seasons it swept. */
type Zaehler = Omit<FLSpielbestaetigungSweepResponse, "saison_id">;

/**
 * One pass over every season the listing answers, for the scheduler (`fl_frontend/src/instrumentation-node.ts ::
 * armScheduler`), whose drain after its jobs sends every mail the pass owed. Rejects where the listing or a season's
 * pass fails, the seasons after it left to the next pass; each season's pass is idempotent. The fixture pages show what
 * it closed within the `minutes` lifetime their cached read keeps.
 */
export async function runSpielSweep(): Promise<void> {
  const { saison_ids: saisonIds } = await getSpielbestaetigungSweepSaisons();

  const zaehler: Zaehler = { geschlossen: 0, angefragt: 0, erinnert: 0, mails: 0, fehlgeschlagen: 0 };
  // Season by season and never in parallel: one slow pass costs nothing, where a fan-out would put every season's
  // writes on the database at once.
  for (const saisonId of saisonIds) {
    const antwort = await postSpielbestaetigungSweep(saisonId);
    zaehler.geschlossen += antwort.geschlossen;
    zaehler.angefragt += antwort.angefragt;
    zaehler.erinnert += antwort.erinnert;
    zaehler.mails += antwort.mails;
    zaehler.fehlgeschlagen += antwort.fehlgeschlagen;
  }

  // A warning where rows were passed over, each pass moving on past them: only that count tells such a pass from a
  // healthy one.
  if (zaehler.fehlgeschlagen === 0) logger.info("spielbestaetigung.sweep_pass", zaehler);
  else logger.warn("spielbestaetigung.sweep_pass", zaehler);
}
