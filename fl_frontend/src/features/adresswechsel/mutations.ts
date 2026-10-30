import {
  adresswechselDeleteAdresswechsel,
  adresswechselEinladenAdresswechsel,
  adresswechselGetAdresswechselAdresse,
  adresswechselGetAdresswechselAnsicht,
  adresswechselGetAdresswechselVerwaltungAnsicht,
  adresswechselPostAdresswechselAntwort,
  adresswechselPostAdresswechselGenehmigung,
  adresswechselPostAdresswechselPostausgang,
  adresswechselPostAdresswechselStopp,
  adresswechselPostAdresswechselVerwaltung,
  adresswechselPostAdresswechselZugestellt,
  adresswechselSweepAdresswechsel,
} from "@/core/generated/client/sdk";

import type {
  FLAdresswechselAdressePayload,
  FLAdresswechselAdresseResponse,
  FLAdresswechselAnsichtPayload,
  FLAdresswechselAnsichtResponse,
  FLAdresswechselAntwortPayload,
  FLAdresswechselAntwortResponse,
  FLAdresswechselGenehmigungResponse,
  FLAdresswechselIdResponse,
  FLAdresswechselPostausgangResponse,
  FLAdresswechselStoppPayload,
  FLAdresswechselStoppResponse,
  FLAdresswechselSweepResponse,
  FLAdresswechselVerwaltungAnsichtPayload,
  FLAdresswechselVerwaltungAnsichtResponse,
  FLAdresswechselVerwaltungMintResponse,
  FLAdresswechselVerwaltungPayload,
  FLAdresswechselZugestelltPayload,
  FLAdresswechselZugestelltResponse,
} from "@/core/generated/client/types";
import type { FLAdresswechselEinladenPayload, FLAdresswechselGenehmigungPayload, FLAdresswechselVerwerfenPayload } from "./schemas";

/**
 * A POST that reads: the token is the credential, and a GET would put it in a query string the backend's route template
 * does not redact. On the base tier, as the press is: the token in the body is the whole authorization.
 */
export async function postAdresswechselAnsicht(payload: FLAdresswechselAnsichtPayload): Promise<FLAdresswechselAnsichtResponse> {
  return adresswechselGetAdresswechselAnsicht(payload, { readOnly: true });
}

/** The new mailbox's own answer. */
export async function postAdresswechselAntwort(payload: FLAdresswechselAntwortPayload): Promise<FLAdresswechselAntwortResponse> {
  return adresswechselPostAdresswechselAntwort(payload);
}

/** The stop of the address on file, which hands nothing over. */
export async function postAdresswechselStopp(payload: FLAdresswechselStoppPayload): Promise<FLAdresswechselStoppResponse> {
  return adresswechselPostAdresswechselStopp(payload);
}

/** The hourly pass's: a timer holds no session, and a lapsed change or a due one is the clock's. `nach` is the previous call's answer. */
export async function postAdresswechselSweep(nach: string | null): Promise<FLAdresswechselSweepResponse> {
  // Left out on a pass's first call: the server takes `nach` as an id wherever it is present.
  return adresswechselSweepAdresswechsel(nach === null ? {} : { nach: nach });
}

/** Claims the notices the ends still owe, for this server alone: the answer names addresses. */
export async function postAdresswechselPostausgang(): Promise<FLAdresswechselPostausgangResponse> {
  return adresswechselPostAdresswechselPostausgang();
}

/** Removes the notices a claim delivered, under that claim alone. */
export async function postAdresswechselZugestellt(payload: FLAdresswechselZugestelltPayload): Promise<FLAdresswechselZugestelltResponse> {
  return adresswechselPostAdresswechselZugestellt(payload);
}

/**
 * The new address of the live change a link's token or a change's id names, on the system tier alone: the link's own read
 * serves no address, and this one reaches this server and never a page.
 */
export async function postAdresswechselAdresse(payload: FLAdresswechselAdressePayload): Promise<FLAdresswechselAdresseResponse> {
  return adresswechselGetAdresswechselAdresse(payload, { readOnly: true });
}

/** A POST that reads, for the address it is handed: a GET would put a person's address in the URL every log line keeps. */
export async function postAdresswechselVerwaltungAnsicht(
  payload: FLAdresswechselVerwaltungAnsichtPayload,
): Promise<FLAdresswechselVerwaltungAnsichtResponse> {
  return adresswechselGetAdresswechselVerwaltungAnsicht(payload, { readOnly: true });
}

/** Ends the change standing at the address, so a link minted before stops working at once; the address on file stays in force. */
export async function beantrageAdresswechsel(payload: FLAdresswechselVerwaltungPayload): Promise<FLAdresswechselVerwaltungMintResponse> {
  return adresswechselPostAdresswechselVerwaltung(payload);
}

/** A fresh link to the new mailbox of the change the id names and no other, so the previous link stops working; the stop link stays. */
export async function einladeAdresswechsel({ id }: FLAdresswechselEinladenPayload): Promise<FLAdresswechselVerwaltungMintResponse> {
  return adresswechselEinladenAdresswechsel(id);
}

/** The change the id names, and refused where that one has ended: a stale page never discards its successor. */
export async function verwirfAdresswechsel({ id }: FLAdresswechselVerwerfenPayload): Promise<FLAdresswechselIdResponse> {
  return adresswechselDeleteAdresswechsel(id);
}

/** Another administrator's approval of a grant holder's change, which takes effect in this press where nothing else waits. */
export async function genehmigeAdresswechsel({ id }: FLAdresswechselGenehmigungPayload): Promise<FLAdresswechselGenehmigungResponse> {
  return adresswechselPostAdresswechselGenehmigung(id);
}
