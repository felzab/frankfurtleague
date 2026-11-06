import { bewerbungenGetSweepSaisons, bewerbungenSweepSaison } from "@/core/generated/client/sdk";

import type { FLBewerbungSweepResponse, FLSweepSaisonsResponse } from "@/core/generated/client/types";

/**
 * Every season the retention sweep walks. Here rather than in `queries.ts` beside the other reads
 * because every read there is cached for a render, and this one answers a timer.
 */
export async function getBewerbungSweepSaisons(): Promise<FLSweepSaisonsResponse> {
  // No base-tier season read can serve this: each withholds a `future` season,
  // which is the status every season with an open application holds.
  return bewerbungenGetSweepSaisons();
}

/**
 * Runs one season's retention clocks: every erasure is done and every reminder and deletion notice owed before this
 * answers, the drain sending them.
 */
export async function postBewerbungSweep(saisonId: string): Promise<FLBewerbungSweepResponse> {
  return bewerbungenSweepSaison(saisonId);
}
