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
 * Every reminder and notice the backend owed is the Postausgang's drain to send. Rejects where a half could not finish
 * what it owes, once both have run; resolves to the erasures the pass passed over and the lapsed address changes it left.
 */
export async function runBewerbungSweep(): Promise<number> {
  const saisons = await sweepAlleSaisons().then(
    (uebergangen) => ({ uebergangen: uebergangen }),
    (fehler: unknown) => ({ fehler: fehler }),
  );
  // After the seasons and whatever they met, so a lapsed address is ended every hour; the half rejects on a failure that
  // ends its pass, for the heartbeat to name.
  const adressen = await sweepAdresswechsel();

  if ("fehler" in saisons) throw saisons.fehler;

  return saisons.uebergangen + adressen;
}

/**
 * Every season, each half of each apart: a throw in one leaves the others' clocks running. Rejects once all have run
 * where any failed, with every failure; resolves to the rows the calls passed over.
 */
async function sweepAlleSaisons(): Promise<number> {
  const { saison_ids: saisonIds } = await getBewerbungSweepSaisons();

  const uebergangen: Uebergangen = { bewerbung: 0, registrierung: 0 };
  const fehler: unknown[] = [];
  // Season by season and never in parallel: the sweep is on the clock of a day, and one slow pass costs nothing.
  for (const saisonId of saisonIds) {
    // Its own event per half: one line for both cannot say which stopped, and that is the question
    // `docs/ops/runbooks.md` section 9 sends an operator to the logs with.
    await halbe("bewerbung.sweep_failed", saisonId, fehler, async () => {
      uebergangen.bewerbung += (await postBewerbungSweep(saisonId)).fehlgeschlagen;
    });
    await halbe("registrierung.sweep_failed", saisonId, fehler, async () => {
      uebergangen.registrierung += (await postRegistrierungSweep(saisonId)).fehlgeschlagen;
    });
  }

  logPass("bewerbung.sweep_pass", { fehlgeschlagen: uebergangen.bewerbung }, uebergangen.bewerbung);
  logPass("registrierung.sweep_pass", { fehlgeschlagen: uebergangen.registrierung }, uebergangen.registrierung);

  if (fehler.length > 0) throw new AggregateError(fehler, `${String(fehler.length)} of the seasons' sweep calls failed.`);

  return uebergangen.bewerbung + uebergangen.registrierung;
}

/** One season's half, its failure filed under its own line and kept for the pass's rejection. */
async function halbe(event: SweepFailure, saisonId: string, fehler: unknown[], lauf: () => Promise<void>): Promise<void> {
  try {
    await lauf();
  } catch (error) {
    logSweepFailure(event, error, saisonId);
    fehler.push(error);
  }
}

/**
 * A warning where rows the half failed or passed over stand: each pass moves on past them, so only this count tells a
 * half failing on every row from a healthy one.
 */
function logPass(event: "bewerbung.sweep_pass" | "registrierung.sweep_pass", felder: Record<string, unknown>, offen: number): void {
  if (offen === 0) logger.info(event, felder);
  else logger.warn(event, felder);
}

/** The half, the season and the error's name, never a person: this line is written for a season nobody swept. */
function logSweepFailure(event: SweepFailure, error: unknown, saisonId: string): void {
  logger.error(event, undefined, {
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    saison_id: saisonId,
  });
}
