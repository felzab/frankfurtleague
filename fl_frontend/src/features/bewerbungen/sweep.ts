import "server-only";

import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { sweepAdresswechsel } from "@/features/adresswechsel/sweep";
import { postRegistrierungSweep } from "@/features/registrierungen/mutations";

import { getBewerbungSweepSaisons, postBewerbungSweep } from "./mutations";

/** Which half of the pass a failure line is about. Each clock family stops for its own reasons. */
type SweepFailure = "bewerbung.sweep_failed" | "registrierung.sweep_failed";

/** The rows each season half's calls passed over in one pass, summed over the seasons that answered. */
type Uebergangen = { bewerbung: number; registrierung: number };

/**
 * One pass over every season, then the clock no season holds (`docs/datenschutz.md :: 6`), for the scheduler
 * (`fl_frontend/src/instrumentation-node.ts :: armScheduler`), which runs one pass at a time.
 *
 * Every reminder and notice the backend owed is the Postausgang's drain to send. Answers the rows each half passed over
 * and what the address changes did, `offen` the erasures passed over and the lapsed changes left, and the seasons'
 * failure, once both halves have run, as `error`; a lapsed address the half could not end rejects, for the heartbeat
 * to name.
 */
export async function runBewerbungSweep() {
  // A listing that failed is the seasons' failure too, and the address changes still run.
  const saisons = await sweepAlleSaisons().catch((fehler: unknown) => ({ uebergangen: { bewerbung: 0, registrierung: 0 }, fehler: fehler }));
  // After the seasons and whatever they met, so a lapsed address is ended every hour.
  const adressen = await sweepAdresswechsel();

  return {
    count: {
      bewerbung_failed: saisons.uebergangen.bewerbung,
      registrierung_failed: saisons.uebergangen.registrierung,
      address_change_removed: adressen.removed,
      address_change_effective: adressen.effective,
      address_change_discarded: adressen.discarded,
      address_change_remaining: adressen.remaining,
    },
    open: saisons.uebergangen.bewerbung + saisons.uebergangen.registrierung + adressen.remaining,
    error: saisons.fehler,
  };
}

/**
 * Every season, each half of each apart: a throw in one leaves the others' clocks running. Answers the rows the calls
 * passed over and, where any call failed, every failure as one; a listing that fails rejects.
 */
async function sweepAlleSaisons(): Promise<{ uebergangen: Uebergangen; fehler?: unknown }> {
  const { saison_ids: saisonIds } = await getBewerbungSweepSaisons();

  const uebergangen: Uebergangen = { bewerbung: 0, registrierung: 0 };
  const fehler: unknown[] = [];
  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass costs nothing.
  for (const saisonId of saisonIds) {
    // Its own event per half: one line for both cannot say which stopped, and that is the question
    // `docs/ops/runbooks.md` section 9 sends an operator to the logs with.
    await halbe("bewerbung.sweep_failed", saisonId, fehler, async () => {
      uebergangen.bewerbung += (await postBewerbungSweep(saisonId)).failed;
    });
    await halbe("registrierung.sweep_failed", saisonId, fehler, async () => {
      uebergangen.registrierung += (await postRegistrierungSweep(saisonId)).failed;
    });
  }

  if (fehler.length === 0) return { uebergangen: uebergangen };

  return { uebergangen: uebergangen, fehler: new AggregateError(fehler, `${String(fehler.length)} of the seasons' sweep calls failed.`) };
}

/** One season's half, its failure filed under its own line and kept for the pass's answer. */
async function halbe(event: SweepFailure, saisonId: string, fehler: unknown[], lauf: () => Promise<void>): Promise<void> {
  try {
    await lauf();
  } catch (error) {
    logSweepFailure(event, error, saisonId);
    fehler.push(error);
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
