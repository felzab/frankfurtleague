import "server-only";

import { requestOf } from "@/core/errors";
import {
  bewerbungenSweepSaison,
  registrierungenSweepRegistrierungen,
  saisonsGetSweepSaisons,
  saisonsSweepSaisonRetention,
} from "@/core/generated/client/sdk";
import { logger } from "@/core/logging";

/** Which half of a pass over the seasons a failure line is about. Each clock family stops for its own reasons. */
type SweepFailure = "bewerbung.sweep_failed" | "registrierung.sweep_failed" | "saison.sweep_failed" | "spielbestaetigung.sweep_failed";

/**
 * One pass over every season, each half of each apart: a throw in one leaves the others' clocks running. The scheduler
 * runs one pass at a time.
 *
 * Every reminder and notice the backend owed is the Postausgang's drain to send. Answers the rows each half passed over,
 * summed over the seasons that answered, `open` their sum, and every half's failure as one `error` once every half has
 * run; a listing that fails rejects.
 */
export async function runSaisonSweep() {
  // Every status, and no base-tier season read: each withholds a `future` season, which is the status every season with
  // an open application holds.
  const { saison_ids: saisonIds } = await saisonsGetSweepSaisons();

  const count = { bewerbung_failed: 0, registrierung_failed: 0, saison_failed: 0 };
  const error: unknown[] = [];
  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass costs nothing.
  for (const saisonId of saisonIds) {
    // Its own event per half: one line for all cannot say which stopped, which is what an operator reads the logs for.
    await halfRun("bewerbung.sweep_failed", saisonId, error, async () => {
      count.bewerbung_failed += (await bewerbungenSweepSaison(saisonId)).failed;
    });
    await halfRun("registrierung.sweep_failed", saisonId, error, async () => {
      count.registrierung_failed += (await registrierungenSweepRegistrierungen(saisonId)).failed;
    });
    // The season rows' contact persons, fixture answers and match reports.
    await halfRun("saison.sweep_failed", saisonId, error, async () => {
      count.saison_failed += (await saisonsSweepSaisonRetention(saisonId)).failed;
    });
  }

  return {
    count,
    open: count.bewerbung_failed + count.registrierung_failed + count.saison_failed,
    error: error.length === 0 ? undefined : new AggregateError(error, `${String(error.length)} of the seasons' sweep calls failed.`),
  };
}

export async function halfRun(event: SweepFailure, saisonId: string, errors: unknown[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    logSweepFailure(event, error, saisonId);
    errors.push(error);
  }
}

/** The half, the season and the error's name, never a person: this line is written for a season nobody swept. */
function logSweepFailure(event: SweepFailure, error: unknown, saisonId: string): void {
  logger.error(event, undefined, {
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    saison_id: saisonId,
  });
}
