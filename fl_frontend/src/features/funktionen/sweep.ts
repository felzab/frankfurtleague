import "server-only";

import { deleteAccountFor, listAccounts } from "@/core/auth";
import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";
import { HOUR_MS } from "@/core/timeUnits";

import { REFERENZEN_ADRESSEN_MAX } from "./constants";
import { postReferenzen } from "./mutations";

/**
 * One hour, as the application sweep's: an account nothing references admits no sign-in to any panel,
 * so a later pass costs nobody anything, and a shorter interval only asks the backend more often.
 */
const SWEEP_INTERVAL_MS = HOUR_MS;

/**
 * A minute after start rather than at once: a deploy recreates this container before the backend
 * answers, so an immediate pass would log a failure for nothing. The first tick alone would skip a
 * container recreated daily.
 */
const SWEEP_START_DELAY_MS = 60 * 1000;

/** What one pass did, by count and never by address: the completion line is all that records it. */
type Zaehlung = {
  gelistet: number;
  unreferenziert: number;
  geloescht: number;
  bereits_geloescht: number;
  fehlgeschlagen: number;
};

/**
 * Arms the account sweep for the life of this process.
 *
 * Production runs one frontend container, so one process holds one timer and no cross-process lease
 * is built.
 */
export function armKontoSweep(): void {
  const erster = setTimeout(() => void runKontoSweep(), SWEEP_START_DELAY_MS);
  const handle = setInterval(() => void runKontoSweep(), SWEEP_INTERVAL_MS);

  // Unreferenced, so neither a pending first pass nor a tick holds a shutdown open behind it: the
  // listening socket is what keeps this process alive.
  erster.unref();
  handle.unref();
}

/** Whether a pass is still running. Module state, which is per process, and one process holds the timer. */
let laeuft = false;

/**
 * One pass over every sign-in account, deleting those no record references.
 *
 * Settles rather than throws: nothing awaits this, so a rejection would surface as an unhandled one
 * an hour after the tick that caused it.
 */
export async function runKontoSweep(): Promise<void> {
  if (laeuft) {
    // A pass slower than the hour would otherwise ask and delete beside itself over the same accounts.
    logger.info("konto.sweep_skipped");
    return;
  }

  laeuft = true;
  try {
    await sweepAlleKonten();
  } finally {
    laeuft = false;
  }
}

async function sweepAlleKonten(): Promise<void> {
  let konten: readonly string[];

  try {
    konten = await listAccounts();
  } catch (error) {
    // No completion line: a pass that listed nothing it could read did not run.
    logKontoFailure("konto.sweep_failed", error);
    return;
  }

  const zaehlung: Zaehlung = { gelistet: konten.length, unreferenziert: 0, geloescht: 0, bereits_geloescht: 0, fehlgeschlagen: 0 };

  // Batch by batch, each within the read's ceiling: a larger one, or an empty one, is refused whole,
  // every pass alike, and the sweep would then delete nothing ever after.
  for (let start = 0; start < konten.length; start += REFERENZEN_ADRESSEN_MAX) {
    const batch = konten.slice(start, start + REFERENZEN_ADRESSEN_MAX);
    let unreferenziert: readonly string[];

    try {
      ({ unreferenziert } = await postReferenzen({ identifiers: batch }));
    } catch (error) {
      // Kept, every one: an answer that never came says nothing about any address in it.
      zaehlung.fehlgeschlagen += batch.length;
      logKontoFailure("konto.referenzen_failed", error, batch.length);
      continue;
    }

    zaehlung.unreferenziert += unreferenziert.length;
    // One at a time: each delete is a transaction of its own, and its ask is meant to come just before it.
    for (const adresse of unreferenziert) {
      await loescheKonto(adresse, zaehlung);
    }
  }

  // Every completed pass, nothing being stored: this line is how "has it run" is answered.
  // A warning where a failure kept accounts, so a level above INFO still shows a pass that judged none.
  if (zaehlung.fehlgeschlagen === 0) logger.info("konto.sweep_completed", zaehlung);
  else logger.warn("konto.sweep_completed", zaehlung);
}

/** One account, deleted only where the read answers its address unreferenced again, alone. */
async function loescheKonto(adresse: string, zaehlung: Zaehlung): Promise<void> {
  try {
    // Asked again immediately before the delete rather than trusted from the batch: a record entered
    // since then keeps its account, and the race narrows to the seconds between this answer and the delete.
    const { unreferenziert } = await postReferenzen({ identifiers: [adresse] });
    if (!unreferenziert.includes(adresse)) return;

    if (await deleteAccountFor(adresse)) zaehlung.geloescht += 1;
    else zaehlung.bereits_geloescht += 1;
  } catch (error) {
    zaehlung.fehlgeschlagen += 1;
    logKontoFailure("konto.delete_failed", error);
  }
}

/** The step and the error's name, never the address: a failure on this path routinely carries it. */
function logKontoFailure(
  event: "konto.sweep_failed" | "konto.referenzen_failed" | "konto.delete_failed",
  error: unknown,
  anzahl?: number,
): void {
  logger.error(event, undefined, {
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    anzahl: anzahl,
  });
}
