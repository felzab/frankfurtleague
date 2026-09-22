import { apiClient } from "@/core/api";

import {
  FLEinladungAnsichtResponseSchema,
  FLPostRegistrierungResponseSchema,
  FLRegistrierungBestaetigungAnsichtResponseSchema,
  FLRegistrierungBestaetigungResponseSchema,
  FLRegistrierungSweepResponseSchema,
} from "./schemas";

import type {
  FLEinladungAnsichtPayload,
  FLEinladungAnsichtResponse,
  FLPostRegistrierungPayload,
  FLPostRegistrierungResponse,
  FLRegistrierungBestaetigungAnsichtPayload,
  FLRegistrierungBestaetigungAnsichtResponse,
  FLRegistrierungBestaetigungPayload,
  FLRegistrierungBestaetigungResponse,
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
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/** Records one pupil's registration and mints the confirmation token in the same transaction. */
export async function postRegistrierung(payload: FLPostRegistrierungPayload): Promise<FLPostRegistrierungResponse> {
  return apiClient<FLPostRegistrierungResponse>("/registrierungen", FLPostRegistrierungResponseSchema, {
    method: "POST",
    authType: "base",
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
    { method: "POST", authType: "base", body: JSON.stringify(payload) },
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
