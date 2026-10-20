import { apiClient } from "@/core/api";

import {
  FLAdresswechselAnsichtResponseSchema,
  FLAdresswechselAntwortResponseSchema,
  FLAdresswechselGenehmigungResponseSchema,
  FLAdresswechselIdResponseSchema,
  FLAdresswechselStoppResponseSchema,
  FLAdresswechselSweepResponseSchema,
  FLAdresswechselVerwaltungAnsichtResponseSchema,
  FLAdresswechselVerwaltungMintResponseSchema,
} from "./schemas";

import type {
  FLAdresswechselAnsichtPayload,
  FLAdresswechselAnsichtResponse,
  FLAdresswechselAntwortPayload,
  FLAdresswechselAntwortResponse,
  FLAdresswechselEinladenPayload,
  FLAdresswechselGenehmigungPayload,
  FLAdresswechselGenehmigungResponse,
  FLAdresswechselIdResponse,
  FLAdresswechselStoppPayload,
  FLAdresswechselStoppResponse,
  FLAdresswechselSweepResponse,
  FLAdresswechselVerwaltungAnsichtPayload,
  FLAdresswechselVerwaltungAnsichtResponse,
  FLAdresswechselVerwaltungMintResponse,
  FLAdresswechselVerwaltungPayload,
  FLAdresswechselVerwerfenPayload,
} from "./schemas";

/** A POST that reads: the token is the credential, and a GET would put it in a query string the backend's route template does not redact. */
export async function postAdresswechselAnsicht(payload: FLAdresswechselAnsichtPayload): Promise<FLAdresswechselAnsichtResponse> {
  return apiClient<FLAdresswechselAnsichtResponse>("/adresswechsel/bestaetigung/ansicht", FLAdresswechselAnsichtResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/**
 * The new mailbox's own answer. `base`, not `admin`: the token in the body is the whole authorization,
 * and an admin key on this call would make the public page a route into the admin tier.
 */
export async function postAdresswechselAntwort(payload: FLAdresswechselAntwortPayload): Promise<FLAdresswechselAntwortResponse> {
  return apiClient<FLAdresswechselAntwortResponse>("/adresswechsel/bestaetigung", FLAdresswechselAntwortResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/** The stop of the address on file, `base` for `postAdresswechselAntwort`'s reason; it hands nothing over. */
export async function postAdresswechselStopp(payload: FLAdresswechselStoppPayload): Promise<FLAdresswechselStoppResponse> {
  return apiClient<FLAdresswechselStoppResponse>("/adresswechsel/bestaetigung/stopp", FLAdresswechselStoppResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}

/**
 * The hourly pass's, on the system tier: a timer holds no session, and a lapsed change or a due one is the clock's.
 * `nach` is the previous call's answer.
 */
export async function postAdresswechselSweep(nach: string | null): Promise<FLAdresswechselSweepResponse> {
  // Left out on a pass's first call: the server takes `nach` as an id wherever it is present.
  const params: { nach?: string } = nach === null ? {} : { nach: nach };
  return apiClient<FLAdresswechselSweepResponse>("/adresswechsel/sweep", FLAdresswechselSweepResponseSchema, {
    method: "POST",
    authType: "system",
    params: params,
  });
}

/** A POST that reads, for the address it is handed: a GET would put a person's address in the URL every log line keeps. */
export async function postAdresswechselVerwaltungAnsicht(
  payload: FLAdresswechselVerwaltungAnsichtPayload,
): Promise<FLAdresswechselVerwaltungAnsichtResponse> {
  return apiClient<FLAdresswechselVerwaltungAnsichtResponse>("/adresswechsel/ansicht", FLAdresswechselVerwaltungAnsichtResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

/** Ends the change standing at the address, so a link minted before stops working at once; the address on file stays in force. */
export async function beantrageAdresswechsel(payload: FLAdresswechselVerwaltungPayload): Promise<FLAdresswechselVerwaltungMintResponse> {
  return apiClient<FLAdresswechselVerwaltungMintResponse>("/adresswechsel", FLAdresswechselVerwaltungMintResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

/** A fresh link to the new mailbox of the change the id names and no other, so the previous link stops working; the stop link stays. */
export async function einladeAdresswechsel({ id }: FLAdresswechselEinladenPayload): Promise<FLAdresswechselVerwaltungMintResponse> {
  return apiClient<FLAdresswechselVerwaltungMintResponse>(`/adresswechsel/${id}/einladen`, FLAdresswechselVerwaltungMintResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/** The change the id names, and refused where that one has ended: a stale page never discards its successor. */
export async function verwirfAdresswechsel({ id }: FLAdresswechselVerwerfenPayload): Promise<FLAdresswechselIdResponse> {
  return apiClient<FLAdresswechselIdResponse>(`/adresswechsel/${id}`, FLAdresswechselIdResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

/** Another administrator's approval of a grant holder's change, which takes effect in this press where nothing else waits. */
export async function genehmigeAdresswechsel({ id }: FLAdresswechselGenehmigungPayload): Promise<FLAdresswechselGenehmigungResponse> {
  return apiClient<FLAdresswechselGenehmigungResponse>(`/adresswechsel/${id}/genehmigung`, FLAdresswechselGenehmigungResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}
