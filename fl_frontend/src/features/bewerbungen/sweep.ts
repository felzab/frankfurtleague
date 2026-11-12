import "server-only";

import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { sweepAddressChange } from "@/features/address-change/sweep";
import { postRegistrierungSweep } from "@/features/registrierungen/mutations";
import { postSchiedsrichterSweep } from "@/features/schiedsrichter/mutations";

import { getBewerbungSweepSaisons, postBewerbungSweep } from "./mutations";

/** Which half of the pass a failure line is about. Each clock family stops for its own reasons. */
type SweepFailure = "bewerbung.sweep_failed" | "registrierung.sweep_failed";

/** The rows each season half's calls passed over in one pass, summed over the seasons that answered. */
type PassedOver = { bewerbung: number; registrierung: number };

/**
 * One pass over every season, then the two clocks no season holds, the address changes' and the unconfirmed referee
 * entries'. The scheduler runs one pass at a time.
 *
 * Every reminder and notice the backend owed is the Postausgang's drain to send. Answers the rows each half passed over
 * and what the address changes and the referee clock did, `open` the erasures passed over and the lapsed changes left,
 * and the seasons' failure, once both halves have run, as `error`; a lapsed address the half could not end, or a
 * referee clock that failed, rejects, for the heartbeat to name.
 */
export async function runBewerbungSweep() {
  // A listing that failed is the seasons' failure too, and the address changes still run.
  const saisons = await sweepAllSaisons().catch((error: unknown) => ({ passedOver: { bewerbung: 0, registrierung: 0 }, error }));
  // After the seasons and whatever they met, so a lapsed address is ended every hour.
  const adressen = await sweepAddressChange();
  // The other clock no season holds: an entry whose link lapsed unanswered or declined, erased with its log images.
  const schiedsrichter = await postSchiedsrichterSweep();

  return {
    count: {
      bewerbung_failed: saisons.passedOver.bewerbung,
      registrierung_failed: saisons.passedOver.registrierung,
      address_change_removed: adressen.removed,
      address_change_effective: adressen.effective,
      address_change_discarded: adressen.discarded,
      address_change_remaining: adressen.remaining,
      schiedsrichter_erased: schiedsrichter.erased,
      schiedsrichter_failed: schiedsrichter.failed,
    },
    open: saisons.passedOver.bewerbung + saisons.passedOver.registrierung + adressen.remaining + schiedsrichter.failed,
    error: saisons.error,
  };
}

/**
 * Every season, each half of each apart: a throw in one leaves the others' clocks running. Answers the rows the calls
 * passed over and, where any call failed, every failure as one; a listing that fails rejects.
 */
async function sweepAllSaisons(): Promise<{ passedOver: PassedOver; error?: unknown }> {
  const { saison_ids: saisonIds } = await getBewerbungSweepSaisons();

  const passedOver: PassedOver = { bewerbung: 0, registrierung: 0 };
  const error: unknown[] = [];
  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass costs nothing.
  for (const saisonId of saisonIds) {
    // Its own event per half: one line for both cannot say which stopped, which is what an operator reads the logs for.
    await halfRun("bewerbung.sweep_failed", saisonId, error, async () => {
      passedOver.bewerbung += (await postBewerbungSweep(saisonId)).failed;
    });
    await halfRun("registrierung.sweep_failed", saisonId, error, async () => {
      passedOver.registrierung += (await postRegistrierungSweep(saisonId)).failed;
    });
  }

  if (error.length === 0) return { passedOver };

  return { passedOver, error: new AggregateError(error, `${String(error.length)} of the seasons' sweep calls failed.`) };
}

async function halfRun(event: SweepFailure, saisonId: string, errors: unknown[], run: () => Promise<void>): Promise<void> {
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
