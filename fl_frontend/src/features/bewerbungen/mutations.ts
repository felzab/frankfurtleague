import { apiClient } from "@/core/api";

import {
  FLAblehnenBewerbungResponseSchema,
  FLAnnehmenBewerbungResponseSchema,
  FLBewerbungEinwilligungAnsichtResponseSchema,
  FLBewerbungEinwilligungAntwortResponseSchema,
  FLBewerbungEinwilligungErneutResponseSchema,
  FLBewerbungKontaktEmailResponseSchema,
  FLBewerbungSweepAngekuendigtResponseSchema,
  FLBewerbungSweepLoeschenResponseSchema,
  FLBewerbungSweepResponseSchema,
  FLBewerbungSweepSaisonsResponseSchema,
  FLBewerbungZustellungResponseSchema,
  FLPostBewerbungResponseSchema,
} from "./schemas";

import type {
  FLAblehnenBewerbungPayload,
  FLAblehnenBewerbungResponse,
  FLAnnehmenBewerbungPayload,
  FLAnnehmenBewerbungResponse,
  FLBewerbungEinwilligungAnsichtPayload,
  FLBewerbungEinwilligungAnsichtResponse,
  FLBewerbungEinwilligungAntwortPayload,
  FLBewerbungEinwilligungAntwortResponse,
  FLBewerbungEinwilligungErneutResponse,
  FLBewerbungKontaktEmailPayload,
  FLBewerbungKontaktEmailResponse,
  FLBewerbungSweepAngekuendigtPayload,
  FLBewerbungSweepAngekuendigtResponse,
  FLBewerbungSweepLoeschenPayload,
  FLBewerbungSweepLoeschenResponse,
  FLBewerbungSweepResponse,
  FLBewerbungSweepSaisonsResponse,
  FLBewerbungZustellungAngenommenPayload,
  FLBewerbungZustellungEreignisPayload,
  FLBewerbungZustellungResponse,
  FLEinwilligungErneutPayload,
  FLPostBewerbungPayload,
  FLPostBewerbungResponse,
} from "./schemas";

/**
 * Accepts the application: creates the club where the school is new, enters it into the season and
 * records the decision, in one transaction on the backend.
 *
 * The id goes in the path, never the body: the backend model refuses a body that names one.
 */
export async function annehmenBewerbung({ id, ...fields }: FLAnnehmenBewerbungPayload): Promise<FLAnnehmenBewerbungResponse> {
  return apiClient<FLAnnehmenBewerbungResponse>(`/bewerbungen/${id}/annehmen`, FLAnnehmenBewerbungResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Moves `status` and `entscheidung` and nothing else: what the school wrote stays the record the
// decision was taken against.
export async function ablehnenBewerbung({ id, ...fields }: FLAblehnenBewerbungPayload): Promise<FLAblehnenBewerbungResponse> {
  return apiClient<FLAblehnenBewerbungResponse>(`/bewerbungen/${id}/ablehnen`, FLAblehnenBewerbungResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

/**
 * Records one school's application, at the base tier as every visitor's write here is: the endpoint
 * is public, and over-declaring the tier succeeds silently.
 */
export async function postBewerbung(payload: FLPostBewerbungPayload): Promise<FLPostBewerbungResponse> {
  return apiClient<FLPostBewerbungResponse>("/bewerbungen", FLPostBewerbungResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postEinwilligungAnsicht(payload: FLBewerbungEinwilligungAnsichtPayload): Promise<FLBewerbungEinwilligungAnsichtResponse> {
  return apiClient<FLBewerbungEinwilligungAnsichtResponse>("/bewerbungen/einwilligung/ansicht", FLBewerbungEinwilligungAnsichtResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/**
 * Records one contact person's answer and spends their token. Base tier, as the create is: the
 * token authorises, and an over-declared tier succeeds silently.
 */
export async function postEinwilligung(payload: FLBewerbungEinwilligungAntwortPayload): Promise<FLBewerbungEinwilligungAntwortResponse> {
  return apiClient<FLBewerbungEinwilligungAntwortResponse>("/bewerbungen/einwilligung", FLBewerbungEinwilligungAntwortResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/**
 * The token is ANSWERED rather than mailed by the backend: every message this app sends is composed
 * here, and a second mailer would spell the league's wording twice. The deadline moves out with the
 * link (`fl_backend/app/api/bewerbungen/services.py :: compose_erneut_update`).
 */
export async function erneutSendenEinwilligung({ id, rolle }: FLEinwilligungErneutPayload): Promise<FLBewerbungEinwilligungErneutResponse> {
  return apiClient<FLBewerbungEinwilligungErneutResponse>(
    `/bewerbungen/${id}/einwilligung/${rolle}/erneut`,
    FLBewerbungEinwilligungErneutResponseSchema,
    {
      method: "POST",
      authType: "admin",
    },
  );
}

/** **The only field of a submitted application an administrator may move**, answered with a link the caller mails to it. */
export async function korrigierenKontaktEmail({ id, rolle, email }: FLBewerbungKontaktEmailPayload): Promise<FLBewerbungKontaktEmailResponse> {
  return apiClient<FLBewerbungKontaktEmailResponse>(`/bewerbungen/${id}/kontakte/${rolle}/email`, FLBewerbungKontaktEmailResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify({ email: email }),
  });
}

/**
 * The system tier, not admin: a delivery event carries no session, and the send sites reporting an
 * acceptance include two public route handlers and a timer.
 */
export async function meldeZustellungAngenommen(payload: FLBewerbungZustellungAngenommenPayload): Promise<FLBewerbungZustellungResponse> {
  return apiClient<FLBewerbungZustellungResponse>("/bewerbungen/zustellung/angenommen", FLBewerbungZustellungResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}

/**
 * Its own endpoint beside the acceptance above, because the two are judged differently: an
 * acceptance is taken whatever is stored, and an event only where it beats what the seat holds.
 */
export async function meldeZustellEreignis(payload: FLBewerbungZustellungEreignisPayload): Promise<FLBewerbungZustellungResponse> {
  return apiClient<FLBewerbungZustellungResponse>("/bewerbungen/zustellung", FLBewerbungZustellungResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}

/**
 * Every season the retention sweep walks. Here rather than in `queries.ts` beside the other reads
 * because every read there is cached for a render, and this one answers a timer.
 */
export async function getBewerbungSweepSaisons(): Promise<FLBewerbungSweepSaisonsResponse> {
  // `GET /saisons` cannot serve this: it withholds a `future` season
  // (`docs/backend/spec.md :: I47`), which is the status every season with an open application holds.
  return apiClient<FLBewerbungSweepSaisonsResponse>("/bewerbungen/sweep", FLBewerbungSweepSaisonsResponseSchema, {
    // The system tier, not admin: the sweep holds no session, and inventing an actor for a machine
    // is what `fl_backend/app/core/recording.py :: SYSTEM_ACTOR` exists to avoid.
    authType: "system",
  });
}

/**
 * Runs one season's retention clocks: the reminders are stamped before this answers, the three
 * silent clocks have acted, and the deletion candidates are still standing.
 */
export async function postBewerbungSweep(saisonId: string): Promise<FLBewerbungSweepResponse> {
  return apiClient<FLBewerbungSweepResponse>(`/bewerbungen/sweep/${saisonId}`, FLBewerbungSweepResponseSchema, {
    method: "POST",
    authType: "system",
  });
}

/**
 * Records that the deletion notice reached these applications, before anything is erased.
 *
 * Without the stamp a run that mailed and then failed to erase would mail the same people again on
 * every tick after it.
 */
export async function postBewerbungSweepAngekuendigt(
  saisonId: string,
  payload: FLBewerbungSweepAngekuendigtPayload,
): Promise<FLBewerbungSweepAngekuendigtResponse> {
  return apiClient<FLBewerbungSweepAngekuendigtResponse>(
    `/bewerbungen/sweep/${saisonId}/angekuendigt`,
    FLBewerbungSweepAngekuendigtResponseSchema,
    {
      method: "POST",
      authType: "system",
      body: JSON.stringify(payload),
    },
  );
}

/** Erases the announced candidates. The backend re-selects them, so a stale or unannounced id is skipped rather than refused. */
export async function postBewerbungSweepLoeschen(
  saisonId: string,
  payload: FLBewerbungSweepLoeschenPayload,
): Promise<FLBewerbungSweepLoeschenResponse> {
  return apiClient<FLBewerbungSweepLoeschenResponse>(`/bewerbungen/sweep/${saisonId}/loeschen`, FLBewerbungSweepLoeschenResponseSchema, {
    method: "POST",
    authType: "system",
    body: JSON.stringify(payload),
  });
}
