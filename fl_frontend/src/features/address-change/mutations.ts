import {
  addressChangeGetAddressChangeAddress,
  addressChangeGetAddressChangeMoves,
  addressChangeGetAddressChangeView,
  addressChangePostAddressChangeAnswer,
  addressChangePostAddressChangeMovesDone,
  addressChangePostAddressChangeStop,
  addressChangeSweepAddressChange,
} from "@/core/generated/client/sdk";

import type {
  FLAddressChangeAddressPayload,
  FLAddressChangeAddressResponse,
  FLAddressChangeAnswerPayload,
  FLAddressChangeAnswerResponse,
  FLAddressChangeMovesDonePayload,
  FLAddressChangeMovesDoneResponse,
  FLAddressChangeMovesResponse,
  FLAddressChangeStopResponse,
  FLAddressChangeSweepResponse,
  FLAddressChangeViewResponse,
  FLTokenPayload,
} from "@/core/generated/client/types";

/**
 * A POST that reads: the token is the credential, and a GET would put it in a query string the backend's route template
 * does not redact. On the base tier, as the press is: the token in the body is the whole authorization.
 */
export async function postAddressChangeView(payload: FLTokenPayload): Promise<FLAddressChangeViewResponse> {
  return addressChangeGetAddressChangeView(payload);
}

/** The new mailbox's own answer. */
export async function postAddressChangeAnswer(payload: FLAddressChangeAnswerPayload): Promise<FLAddressChangeAnswerResponse> {
  return addressChangePostAddressChangeAnswer(payload);
}

/** The stop of the address on file, which hands nothing over. */
export async function postAddressChangeStop(payload: FLTokenPayload): Promise<FLAddressChangeStopResponse> {
  return addressChangePostAddressChangeStop(payload);
}

/** The hourly pass's: a timer holds no session, and a lapsed change or a due one is the clock's. `after` is the previous call's answer. */
export async function postAdresswechselSweep(after: string | null): Promise<FLAddressChangeSweepResponse> {
  // Left out on a pass's first call: the server takes `after` as an id wherever it is present.
  return addressChangeSweepAddressChange(after === null ? {} : { after });
}

/** The sign-in accounts the effects still owe to carry, for this server alone: the answer names addresses. */
export async function getAdresswechselUmzuege(): Promise<FLAddressChangeMovesResponse> {
  return addressChangeGetAddressChangeMoves();
}

/** Takes the carries done off their changes. */
export async function postAdresswechselUmzuegeErledigt(payload: FLAddressChangeMovesDonePayload): Promise<FLAddressChangeMovesDoneResponse> {
  return addressChangePostAddressChangeMovesDone(payload);
}

/**
 * The new address of the live change a link's token or a change's id names, on the system tier alone: the link's own read
 * serves no address, and this one reaches this server and never a page.
 */
export async function postAdresswechselAdresse(payload: FLAddressChangeAddressPayload): Promise<FLAddressChangeAddressResponse> {
  return addressChangeGetAddressChangeAddress(payload);
}
