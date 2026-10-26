import { apiClient } from "@/core/api";

import {
  FLSpielbestaetigungAnsichtResponseSchema,
  FLSpielbestaetigungAntwortResponseSchema,
  FLSpielbestaetigungEintragenResponseSchema,
  FLSpielbestaetigungSchiedsrichterAntwortResponseSchema,
  FLSpielbestaetigungSweepAngefragtResponseSchema,
  FLSpielbestaetigungSweepMitgeteiltResponseSchema,
  FLSpielbestaetigungSweepResponseSchema,
  FLSpielbestaetigungSweepSaisonsResponseSchema,
  FLSpielbestaetigungVerwerfenResponseSchema,
} from "./schemas";

import type {
  FLSpielbestaetigungAnsichtPayload,
  FLSpielbestaetigungAnsichtResponse,
  FLSpielbestaetigungAntwortPayload,
  FLSpielbestaetigungAntwortResponse,
  FLSpielbestaetigungEintragenPayload,
  FLSpielbestaetigungEintragenResponse,
  FLSpielbestaetigungSchiedsrichterAntwortPayload,
  FLSpielbestaetigungSchiedsrichterAntwortResponse,
  FLSpielbestaetigungSweepAngefragtPayload,
  FLSpielbestaetigungSweepAngefragtResponse,
  FLSpielbestaetigungSweepMitgeteiltPayload,
  FLSpielbestaetigungSweepMitgeteiltResponse,
  FLSpielbestaetigungSweepResponse,
  FLSpielbestaetigungSweepSaisonsResponse,
  FLSpielbestaetigungVerwerfenPayload,
  FLSpielbestaetigungVerwerfenResponse,
} from "./schemas";

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postSpielbestaetigungAnsicht(payload: FLSpielbestaetigungAnsichtPayload): Promise<FLSpielbestaetigungAnsichtResponse> {
  return apiClient<FLSpielbestaetigungAnsichtResponse>("/spielbestaetigungen/ansicht", FLSpielbestaetigungAnsichtResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/** One club's answer, at the base tier: the token authorises, and an over-declared tier succeeds silently. */
export async function postSpielbestaetigung(payload: FLSpielbestaetigungAntwortPayload): Promise<FLSpielbestaetigungAntwortResponse> {
  return apiClient<FLSpielbestaetigungAntwortResponse>("/spielbestaetigungen", FLSpielbestaetigungAntwortResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/** A referee's answer to a row of their own, on the person lane: the signed-in address is what the backend authorises. */
export async function postSpielbestaetigungAntwort(
  spielbestaetigungId: string,
  payload: FLSpielbestaetigungSchiedsrichterAntwortPayload,
): Promise<FLSpielbestaetigungSchiedsrichterAntwortResponse> {
  return apiClient<FLSpielbestaetigungSchiedsrichterAntwortResponse>(
    `/spielbestaetigungen/${spielbestaetigungId}/antwort`,
    FLSpielbestaetigungSchiedsrichterAntwortResponseSchema,
    {
      method: "POST",
      authType: "admin",
      body: JSON.stringify(payload),
    },
  );
}

/**
 * The seasons the confirmation pass visits. Here rather than in a `queries.ts` because every read there is
 * cached for a render, and this one answers a timer.
 */
export async function getSpielbestaetigungSweepSaisons(): Promise<FLSpielbestaetigungSweepSaisonsResponse> {
  return apiClient<FLSpielbestaetigungSweepSaisonsResponse>("/spielbestaetigungen/sweep", FLSpielbestaetigungSweepSaisonsResponseSchema, {
    // The system tier, not admin: the timer holds no session, and an invented actor for a machine is
    // what `fl_backend/app/core/recording.py :: SYSTEM_ACTOR` exists to avoid.
    authType: "system",
  });
}

/** One season's pass: rows closed, minted and reminded, the reminders already stamped and the requests not. */
export async function postSpielbestaetigungSweep(saisonId: string): Promise<FLSpielbestaetigungSweepResponse> {
  return apiClient<FLSpielbestaetigungSweepResponse>(`/spielbestaetigungen/sweep/${saisonId}`, FLSpielbestaetigungSweepResponseSchema, {
    method: "POST",
    authType: "system",
  });
}

/**
 * Stamps the rows whose first messages went, after they went: a row a failed send leaves unstamped reads as never
 * asked rather than as a silence.
 */
export async function postSpielbestaetigungSweepAngefragt(
  saisonId: string,
  payload: FLSpielbestaetigungSweepAngefragtPayload,
): Promise<FLSpielbestaetigungSweepAngefragtResponse> {
  return apiClient<FLSpielbestaetigungSweepAngefragtResponse>(
    `/spielbestaetigungen/sweep/${saisonId}/angefragt`,
    FLSpielbestaetigungSweepAngefragtResponseSchema,
    {
      method: "POST",
      authType: "system",
      body: JSON.stringify(payload),
    },
  );
}

/** Stamps the rows whose notices went, after they went: a notice no stamp names is answered again by the next pass. */
export async function postSpielbestaetigungSweepMitgeteilt(
  saisonId: string,
  payload: FLSpielbestaetigungSweepMitgeteiltPayload,
): Promise<FLSpielbestaetigungSweepMitgeteiltResponse> {
  return apiClient<FLSpielbestaetigungSweepMitgeteiltResponse>(
    `/spielbestaetigungen/sweep/${saisonId}/mitgeteilt`,
    FLSpielbestaetigungSweepMitgeteiltResponseSchema,
    {
      method: "POST",
      authType: "system",
      body: JSON.stringify(payload),
    },
  );
}

export async function eintragenSpielbestaetigung({
  id,
  ...fields
}: FLSpielbestaetigungEintragenPayload): Promise<FLSpielbestaetigungEintragenResponse> {
  return apiClient<FLSpielbestaetigungEintragenResponse>(`/spielbestaetigungen/${id}/eintragen`, FLSpielbestaetigungEintragenResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

export async function verwerfenSpielbestaetigung({ id }: FLSpielbestaetigungVerwerfenPayload): Promise<FLSpielbestaetigungVerwerfenResponse> {
  return apiClient<FLSpielbestaetigungVerwerfenResponse>(`/spielbestaetigungen/${id}/verwerfen`, FLSpielbestaetigungVerwerfenResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
