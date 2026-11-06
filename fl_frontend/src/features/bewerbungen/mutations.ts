import { bewerbungenGetSweepSaisons, bewerbungenPostBewerbung, bewerbungenSweepSaison } from "@/core/generated/client/sdk";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";

import type {
  FLBewerbungSweepResponse,
  FLCreatedResponse,
  FLPostBewerbungPayload,
  FLSweepSaisonsResponse,
} from "@/core/generated/client/types";

/** Records one school's application. */
export async function postBewerbung(payload: FLPostBewerbungPayload, idempotencyKey: string | null): Promise<FLCreatedResponse> {
  return bewerbungenPostBewerbung(payload, { headers: idempotencyKey === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } });
}

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
