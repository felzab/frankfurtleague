import {
  bewerbungenAcceptBewerbung,
  bewerbungenDeclineBewerbung,
  bewerbungenGetSweepSaisons,
  bewerbungenPostBewerbung,
  bewerbungenPostKontaktSeat,
  bewerbungenResendEinwilligung,
  bewerbungenSweepSaison,
} from "@/core/generated/client/sdk";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";

import type {
  FLAcceptBewerbungPayload,
  FLAcceptBewerbungResponse,
  FLBewerbungEinwilligungResendResponse,
  FLBewerbungKontaktSeatPayload,
  FLBewerbungKontaktSeatResponse,
  FLBewerbungSweepResponse,
  FLCreatedResponse,
  FLDeclineBewerbungPayload,
  FLDeclineBewerbungResponse,
  FLKontaktRolle,
  FLPostBewerbungPayload,
  FLSweepSaisonsResponse,
} from "@/core/generated/client/types";

/**
 * Accepts the application: creates the club where the school is new, enters it into the season and
 * records the decision, in one transaction on the backend.
 *
 * The id goes in the path, never the body: the backend model refuses a body that names one.
 */
export async function annehmenBewerbung({
  id,
  gruppe,
  trikot_farbe,
  shorthand,
  version,
}: { id: string } & FLAcceptBewerbungPayload): Promise<FLAcceptBewerbungResponse> {
  return bewerbungenAcceptBewerbung(id, { gruppe: gruppe, trikot_farbe: trikot_farbe, shorthand: shorthand, version: version });
}

// Moves `status` and `entscheidung` and nothing else: what the school wrote stays the record the
// decision was taken against.
export async function ablehnenBewerbung({
  id,
  decision_reason,
  version,
}: { id: string } & FLDeclineBewerbungPayload): Promise<FLDeclineBewerbungResponse> {
  return bewerbungenDeclineBewerbung(id, { decision_reason, version });
}

/** Records one school's application. */
export async function postBewerbung(payload: FLPostBewerbungPayload, idempotencyKey: string | null): Promise<FLCreatedResponse> {
  return bewerbungenPostBewerbung(payload, { headers: idempotencyKey === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } });
}

/**
 * The token is ANSWERED rather than mailed by the backend: every message this app sends is composed
 * here, and a second mailer would spell the league's wording twice. The deadline moves out with the
 * link (`fl_backend/app/api/bewerbungen/services.py :: compose_erneut_update`).
 */
export async function erneutSendenEinwilligung({
  id,
  rolle,
}: {
  id: string;
  rolle: FLKontaktRolle;
}): Promise<FLBewerbungEinwilligungResendResponse> {
  return bewerbungenResendEinwilligung(id, rolle);
}

/** The one path that writes a person onto a submitted application. */
export async function besetzenKontaktSitz({
  id,
  rolle,
  first_name: firstName,
  last_name: lastName,
  email,
  phone,
  version,
}: { id: string; rolle: FLKontaktRolle } & FLBewerbungKontaktSeatPayload): Promise<FLBewerbungKontaktSeatResponse> {
  return bewerbungenPostKontaktSeat(id, rolle, {
    first_name: firstName,
    last_name: lastName,
    email: email,
    phone,
    version,
  });
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
