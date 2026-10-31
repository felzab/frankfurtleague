import {
  addressChangeDeleteAddressChange,
  addressChangeGetAddressChangeAdresse,
  addressChangeGetAddressChangeMoves,
  addressChangeGetAddressChangeVerwaltungView,
  addressChangeGetAddressChangeView,
  addressChangeInviteAddressChange,
  addressChangePostAddressChangeAntwort,
  addressChangePostAddressChangeApproval,
  addressChangePostAddressChangeMovesDone,
  addressChangePostAddressChangeStop,
  addressChangePostAddressChangeVerwaltung,
  addressChangeSweepAddressChange,
} from "@/core/generated/client/sdk";

import type {
  FLAddressChangeAdressePayload,
  FLAddressChangeAdresseResponse,
  FLAddressChangeAntwortPayload,
  FLAddressChangeAntwortResponse,
  FLAddressChangeApprovalResponse,
  FLAddressChangeIdResponse,
  FLAddressChangeMovesDonePayload,
  FLAddressChangeMovesDoneResponse,
  FLAddressChangeMovesResponse,
  FLAddressChangeStopResponse,
  FLAddressChangeSweepResponse,
  FLAddressChangeVerwaltungMintResponse,
  FLAddressChangeVerwaltungPayload,
  FLAddressChangeVerwaltungViewPayload,
  FLAddressChangeVerwaltungViewResponse,
  FLAddressChangeViewResponse,
  FLTokenPayload,
} from "@/core/generated/client/types";
import type { FLAdresswechselEinladenPayload, FLAdresswechselGenehmigungPayload, FLAdresswechselVerwerfenPayload } from "./schemas";

/**
 * A POST that reads: the token is the credential, and a GET would put it in a query string the backend's route template
 * does not redact. On the base tier, as the press is: the token in the body is the whole authorization.
 */
export async function postAdresswechselAnsicht(payload: FLTokenPayload): Promise<FLAddressChangeViewResponse> {
  return addressChangeGetAddressChangeView(payload, { readOnly: true });
}

/** The new mailbox's own answer. */
export async function postAdresswechselAntwort(payload: FLAddressChangeAntwortPayload): Promise<FLAddressChangeAntwortResponse> {
  return addressChangePostAddressChangeAntwort(payload);
}

/** The stop of the address on file, which hands nothing over. */
export async function postAdresswechselStopp(payload: FLTokenPayload): Promise<FLAddressChangeStopResponse> {
  return addressChangePostAddressChangeStop(payload);
}

/** The hourly pass's: a timer holds no session, and a lapsed change or a due one is the clock's. `nach` is the previous call's answer. */
export async function postAdresswechselSweep(nach: string | null): Promise<FLAddressChangeSweepResponse> {
  // Left out on a pass's first call: the server takes `nach` as an id wherever it is present.
  return addressChangeSweepAddressChange(nach === null ? {} : { nach: nach });
}

/** The sign-in accounts the effects still owe to carry, for this server alone: the answer names addresses. */
export async function getAdresswechselUmzuege(): Promise<FLAddressChangeMovesResponse> {
  return addressChangeGetAddressChangeMoves({ readOnly: true });
}

/** Takes the carries done off their changes. */
export async function postAdresswechselUmzuegeErledigt(payload: FLAddressChangeMovesDonePayload): Promise<FLAddressChangeMovesDoneResponse> {
  return addressChangePostAddressChangeMovesDone(payload);
}

/**
 * The new address of the live change a link's token or a change's id names, on the system tier alone: the link's own read
 * serves no address, and this one reaches this server and never a page.
 */
export async function postAdresswechselAdresse(payload: FLAddressChangeAdressePayload): Promise<FLAddressChangeAdresseResponse> {
  return addressChangeGetAddressChangeAdresse(payload, { readOnly: true });
}

/** A POST that reads, for the address it is handed: a GET would put a person's address in the URL every log line keeps. */
export async function postAdresswechselVerwaltungAnsicht(
  payload: FLAddressChangeVerwaltungViewPayload,
): Promise<FLAddressChangeVerwaltungViewResponse> {
  return addressChangeGetAddressChangeVerwaltungView(payload, { readOnly: true });
}

/** Ends the change standing at the address, so a link minted before stops working at once; the address on file stays in force. */
export async function beantrageAdresswechsel(payload: FLAddressChangeVerwaltungPayload): Promise<FLAddressChangeVerwaltungMintResponse> {
  return addressChangePostAddressChangeVerwaltung(payload);
}

/** A fresh link to the new mailbox of the change the id names and no other, so the previous link stops working; the stop link stays. */
export async function einladeAdresswechsel({ id }: FLAdresswechselEinladenPayload): Promise<FLAddressChangeVerwaltungMintResponse> {
  return addressChangeInviteAddressChange(id);
}

/** The change the id names, and refused where that one has ended: a stale page never discards its successor. */
export async function verwirfAdresswechsel({ id }: FLAdresswechselVerwerfenPayload): Promise<FLAddressChangeIdResponse> {
  return addressChangeDeleteAddressChange(id);
}

/** Another administrator's approval of a grant holder's change, which takes effect in this press where nothing else waits. */
export async function genehmigeAdresswechsel({ id }: FLAdresswechselGenehmigungPayload): Promise<FLAddressChangeApprovalResponse> {
  return addressChangePostAddressChangeApproval(id);
}
