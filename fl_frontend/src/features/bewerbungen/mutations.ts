import {
  bewerbungenAblehnenBewerbung,
  bewerbungenAnnehmenBewerbung,
  bewerbungenErneutEinwilligung,
  bewerbungenGetEinwilligungAnsicht,
  bewerbungenGetSweepSaisons,
  bewerbungenPostBewerbung,
  bewerbungenPostEinwilligung,
  bewerbungenPostKontaktEmail,
  bewerbungenPostKontaktSitz,
  bewerbungenSweepSaison,
} from "@/core/generated/client/sdk";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";

import type {
  FLAblehnenBewerbungPayload,
  FLAblehnenBewerbungResponse,
  FLAnnehmenBewerbungPayload,
  FLAnnehmenBewerbungResponse,
  FLBewerbungEinwilligungAbgelehnt,
  FLBewerbungEinwilligungAnsichtResponse,
  FLBewerbungEinwilligungAntwortResponse,
  FLBewerbungEinwilligungErneutResponse,
  FLBewerbungEinwilligungErteilt,
  FLBewerbungKontaktEmailPayload,
  FLBewerbungKontaktEmailResponse,
  FLBewerbungKontaktSitzPayload,
  FLBewerbungSweepResponse,
  FLCreatedResponse,
  FLKontaktRolle,
  FLPostBewerbungPayload,
  FLSaisonTeamEinwilligungAntwortResponse,
  FLSweepSaisonsResponse,
  FLTokenPayload,
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
}: { id: string } & FLAnnehmenBewerbungPayload): Promise<FLAnnehmenBewerbungResponse> {
  return bewerbungenAnnehmenBewerbung(id, { gruppe: gruppe, trikot_farbe: trikot_farbe });
}

// Moves `status` and `entscheidung` and nothing else: what the school wrote stays the record the
// decision was taken against.
export async function ablehnenBewerbung({ id, grund }: { id: string } & FLAblehnenBewerbungPayload): Promise<FLAblehnenBewerbungResponse> {
  return bewerbungenAblehnenBewerbung(id, { grund: grund });
}

/** Records one school's application. */
export async function postBewerbung(payload: FLPostBewerbungPayload, idempotencyKey: string | null): Promise<FLCreatedResponse> {
  return bewerbungenPostBewerbung(payload, { headers: idempotencyKey === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } });
}

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postEinwilligungAnsicht(payload: FLTokenPayload): Promise<FLBewerbungEinwilligungAnsichtResponse> {
  return bewerbungenGetEinwilligungAnsicht(payload, { readOnly: true });
}

/** Records one contact person's answer and spends their token. */
export async function postEinwilligung(
  payload: FLBewerbungEinwilligungErteilt | FLBewerbungEinwilligungAbgelehnt,
): Promise<FLBewerbungEinwilligungAntwortResponse | FLSaisonTeamEinwilligungAntwortResponse> {
  return bewerbungenPostEinwilligung(payload);
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
}): Promise<FLBewerbungEinwilligungErneutResponse> {
  return bewerbungenErneutEinwilligung(id, rolle);
}

/** **The only field of a submitted application an administrator may move**, answered with a link the caller mails to it. */
export async function korrigierenKontaktEmail({
  id,
  rolle,
  email,
  bisherige_email,
}: { id: string; rolle: FLKontaktRolle } & FLBewerbungKontaktEmailPayload): Promise<FLBewerbungKontaktEmailResponse> {
  return bewerbungenPostKontaktEmail(id, rolle, { email: email, bisherige_email: bisherige_email });
}

/** The one path that writes a NAME onto a submitted application, and it runs on a seat its own holder emptied. */
export async function besetzenKontaktSitz({
  id,
  rolle,
  vorname,
  nachname,
  email,
  telefon,
  text_version,
}: { id: string; rolle: FLKontaktRolle } & FLBewerbungKontaktSitzPayload): Promise<FLBewerbungKontaktEmailResponse> {
  return bewerbungenPostKontaktSitz(id, rolle, {
    vorname: vorname,
    nachname: nachname,
    email: email,
    telefon: telefon,
    text_version: text_version,
  });
}

/**
 * Every season the retention sweep walks. Here rather than in `queries.ts` beside the other reads
 * because every read there is cached for a render, and this one answers a timer.
 */
export async function getBewerbungSweepSaisons(): Promise<FLSweepSaisonsResponse> {
  // `GET /saisons` cannot serve this: it withholds a `future` season,
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
