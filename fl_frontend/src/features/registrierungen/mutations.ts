import { apiClient } from "@/core/api";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";

import {
  FLEinladungAnsichtResponseSchema,
  FLPostRegistrierungResponseSchema,
  FLRegistrierungAblehnungResponseSchema,
  FLRegistrierungAufnahmeResponseSchema,
  FLRegistrierungBestaetigungAnsichtResponseSchema,
  FLRegistrierungBestaetigungResponseSchema,
  FLRegistrierungSelbstEinwilligungResponseSchema,
  FLRegistrierungSweepResponseSchema,
} from "./schemas";

import type {
  FLEinladungAnsichtPayload,
  FLEinladungAnsichtResponse,
  FLPostRegistrierungPayload,
  FLPostRegistrierungResponse,
  FLRegistrierungAblehnenPayload,
  FLRegistrierungAblehnungResponse,
  FLRegistrierungAufnahmeResponse,
  FLRegistrierungAufnehmenPayload,
  FLRegistrierungBestaetigungAnsichtPayload,
  FLRegistrierungBestaetigungAnsichtResponse,
  FLRegistrierungBestaetigungPayload,
  FLRegistrierungBestaetigungResponse,
  FLRegistrierungSelbstEinwilligungPayload,
  FLRegistrierungSelbstEinwilligungResponse,
  FLRegistrierungSweepResponse,
} from "./schemas";

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postEinladungAnsicht(payload: FLEinladungAnsichtPayload): Promise<FLEinladungAnsichtResponse> {
  return apiClient<FLEinladungAnsichtResponse>("/registrierungen/einladung/ansicht", FLEinladungAnsichtResponseSchema, {
    // `base`, spelled out: this endpoint is the public tier's, and an over-declared tier succeeds
    // silently.
    method: "POST",
    readOnly: true,
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/** Records one pupil's registration and mints the confirmation token in the same transaction. */
export async function postRegistrierung(
  payload: FLPostRegistrierungPayload,
  idempotencyKey: string | null,
): Promise<FLPostRegistrierungResponse> {
  return apiClient<FLPostRegistrierungResponse>("/registrierungen", FLPostRegistrierungResponseSchema, {
    method: "POST",
    authType: "base",
    headers: idempotencyKey === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    body: JSON.stringify(payload),
  });
}

/** The confirmation link's own read, a POST for `postEinladungAnsicht`'s reason. */
export async function postBestaetigungAnsicht(
  payload: FLRegistrierungBestaetigungAnsichtPayload,
): Promise<FLRegistrierungBestaetigungAnsichtResponse> {
  return apiClient<FLRegistrierungBestaetigungAnsichtResponse>(
    "/registrierungen/bestaetigung/ansicht",
    FLRegistrierungBestaetigungAnsichtResponseSchema,
    { method: "POST", readOnly: true, authType: "base", body: JSON.stringify(payload) },
  );
}

/**
 * Records the pupil's birthdate and consent and spends their token. Base tier, as the create is: the
 * token authorises, and an over-declared tier succeeds silently.
 */
export async function postSpielerBestaetigung(payload: FLRegistrierungBestaetigungPayload): Promise<FLRegistrierungBestaetigungResponse> {
  return apiClient<FLRegistrierungBestaetigungResponse>("/registrierungen/bestaetigung", FLRegistrierungBestaetigungResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/** Admits one registration; the id goes in the path and the body names whom it is admitted into. */
export async function postRegistrierungAufnehmen(
  registrierungId: string,
  payload: FLRegistrierungAufnehmenPayload,
): Promise<FLRegistrierungAufnahmeResponse> {
  return apiClient<FLRegistrierungAufnahmeResponse>(
    `/registrierungen/${encodeURIComponent(registrierungId)}/aufnehmen`,
    FLRegistrierungAufnahmeResponseSchema,
    { method: "POST", authType: "admin", body: JSON.stringify(payload) },
  );
}

/** Declines one registration under a fixed reason. */
export async function postRegistrierungAblehnen(
  registrierungId: string,
  payload: FLRegistrierungAblehnenPayload,
): Promise<FLRegistrierungAblehnungResponse> {
  return apiClient<FLRegistrierungAblehnungResponse>(
    `/registrierungen/${encodeURIComponent(registrierungId)}/ablehnen`,
    FLRegistrierungAblehnungResponseSchema,
    { method: "POST", authType: "admin", body: JSON.stringify(payload) },
  );
}

/**
 * Runs one season's retention clocks. **One call and not three**: the registration gets no
 * pre-notice, so the application flow's mail-stamp-erase ordering has no counterpart, and what this
 * answers is what to mail about work already done.
 */
export async function postRegistrierungSweep(saisonId: string): Promise<FLRegistrierungSweepResponse> {
  return apiClient<FLRegistrierungSweepResponse>(`/registrierungen/sweep/${encodeURIComponent(saisonId)}`, FLRegistrierungSweepResponseSchema, {
    method: "POST",
    // The system tier, not admin: the sweep holds no session, and inventing an actor for a machine
    // is what `fl_backend/app/core/recording.py :: SYSTEM_ACTOR` exists to avoid.
    authType: "system",
  });
}

// A pupil's own withdrawal on their pending registration, under the person lane's actor: the backend
// judges the registration theirs and takes a withdrawal alone until the team admits it.
export async function patchRegistrierungEinwilligung(
  registrierungId: string,
  payload: FLRegistrierungSelbstEinwilligungPayload,
): Promise<FLRegistrierungSelbstEinwilligungResponse> {
  return apiClient<FLRegistrierungSelbstEinwilligungResponse>(
    `/registrierungen/selbst/${encodeURIComponent(registrierungId)}/einwilligung`,
    FLRegistrierungSelbstEinwilligungResponseSchema,
    { method: "PATCH", authType: "admin", body: JSON.stringify(payload) },
  );
}
