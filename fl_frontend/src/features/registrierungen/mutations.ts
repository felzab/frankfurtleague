import {
  registrierungenAblehnen,
  registrierungenAufnehmen,
  registrierungenGetBestaetigungAnsicht,
  registrierungenPatchEinwilligung,
  registrierungenPostBestaetigung,
  registrierungenPostEinladungAnsicht,
  registrierungenPostRegistrierung,
  registrierungenSweepRegistrierungen,
} from "@/core/generated/client/sdk";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";

import type {
  FLEinladungAnsichtResponse,
  FLPostRegistrierungPayload,
  FLPostRegistrierungResponse,
  FLRegistrierungAblehnenPayload,
  FLRegistrierungAblehnungResponse,
  FLRegistrierungAufnahmeResponse,
  FLRegistrierungAufnehmenPayload,
  FLRegistrierungBestaetigungAnsichtResponse,
  FLRegistrierungBestaetigungPayload,
  FLRegistrierungBestaetigungResponse,
  FLRegistrierungSelbstEinwilligungResponse,
  FLRegistrierungSweepResponse,
  FLSelbstEinwilligungPayload,
  FLTokenPayload,
} from "@/core/generated/client/types";

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postEinladungAnsicht(payload: FLTokenPayload): Promise<FLEinladungAnsichtResponse> {
  return registrierungenPostEinladungAnsicht(payload, { readOnly: true });
}

/** Records one pupil's registration and mints the confirmation token in the same transaction. */
export async function postRegistrierung(
  payload: FLPostRegistrierungPayload,
  idempotencyKey: string | null,
): Promise<FLPostRegistrierungResponse> {
  return registrierungenPostRegistrierung(payload, { headers: idempotencyKey === null ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } });
}

/** The confirmation link's own read, a POST for `postEinladungAnsicht`'s reason. */
export async function postBestaetigungAnsicht(payload: FLTokenPayload): Promise<FLRegistrierungBestaetigungAnsichtResponse> {
  return registrierungenGetBestaetigungAnsicht(payload, { readOnly: true });
}

/** Records the pupil's birthdate and consent and spends their token. */
export async function postSpielerBestaetigung(payload: FLRegistrierungBestaetigungPayload): Promise<FLRegistrierungBestaetigungResponse> {
  return registrierungenPostBestaetigung(payload);
}

/** Admits one registration; the id goes in the path and the body names whom it is admitted into. */
export async function postRegistrierungAufnehmen(
  registrierungId: string,
  { spieler_id }: FLRegistrierungAufnehmenPayload,
): Promise<FLRegistrierungAufnahmeResponse> {
  return registrierungenAufnehmen(encodeURIComponent(registrierungId), { spieler_id: spieler_id });
}

/** Declines one registration under a fixed reason. */
export async function postRegistrierungAblehnen(
  registrierungId: string,
  { grund }: FLRegistrierungAblehnenPayload,
): Promise<FLRegistrierungAblehnungResponse> {
  return registrierungenAblehnen(encodeURIComponent(registrierungId), { grund: grund });
}

/**
 * Runs one season's retention clocks. **One call and not three**: the registration gets no
 * pre-notice, so the application flow's mail-stamp-erase ordering has no counterpart, and what this
 * answers is what to mail about work already done.
 */
export async function postRegistrierungSweep(saisonId: string): Promise<FLRegistrierungSweepResponse> {
  return registrierungenSweepRegistrierungen(encodeURIComponent(saisonId));
}

// A pupil's own withdrawal on their pending registration, under the person lane's actor: the backend
// judges the registration theirs and takes a withdrawal alone until the team admits it.
export async function patchRegistrierungEinwilligung(
  registrierungId: string,
  payload: FLSelbstEinwilligungPayload,
): Promise<FLRegistrierungSelbstEinwilligungResponse> {
  return registrierungenPatchEinwilligung(encodeURIComponent(registrierungId), payload);
}
