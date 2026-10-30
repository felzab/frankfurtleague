import "server-only";

import { deleteAccountFor, listAccounts } from "@/core/auth";
import { requestOf } from "@/core/errors";
import { logger } from "@/core/logging";

import { REFERENZEN_ADRESSEN_MAX } from "./constants";
import { postReferenzen } from "./mutations";

/** What one pass did, by count and never by address: the scheduler's pass line is all that records it. */
type Zaehlung = {
  unreferenziert: number;
  geloescht: number;
  bereits_geloescht: number;
  fehlgeschlagen: number;
};

/**
 * One pass over every sign-in account, deleting those no record references, for the scheduler
 * (`fl_frontend/src/instrumentation-node.ts :: armScheduler`), which runs one pass at a time. A store that lists
 * nothing rejects, for the heartbeat to name; the pass resolves to what it did, `offen` the accounts it could not judge
 * or delete.
 */
export async function runKontoSweep(): Promise<{ zaehlung: Zaehlung; offen: number }> {
  const konten = await listAccounts();
  const zaehlung: Zaehlung = { unreferenziert: 0, geloescht: 0, bereits_geloescht: 0, fehlgeschlagen: 0 };

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

  return { zaehlung: zaehlung, offen: zaehlung.fehlgeschlagen };
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
function logKontoFailure(event: "konto.referenzen_failed" | "konto.delete_failed", error: unknown, anzahl?: number): void {
  logger.error(event, undefined, {
    name: error instanceof Error ? error.name : undefined,
    ...requestOf(error),
    anzahl: anzahl,
  });
}
