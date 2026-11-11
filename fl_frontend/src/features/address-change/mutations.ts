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
 * does not redact. The token in the body is the whole authorization.
 */
export async function postAddressChangeView(payload: FLTokenPayload): Promise<FLAddressChangeViewResponse> {
  return addressChangeGetAddressChangeView(payload);
}

export async function postAddressChangeAnswer(payload: FLAddressChangeAnswerPayload): Promise<FLAddressChangeAnswerResponse> {
  return addressChangePostAddressChangeAnswer(payload);
}

export async function postAddressChangeStop(payload: FLTokenPayload): Promise<FLAddressChangeStopResponse> {
  return addressChangePostAddressChangeStop(payload);
}

/** A timer holds no session, and a lapsed change or a due one is the clock's. `after` is the previous call's answer. */
export async function postAddressChangeSweep(after: string | null): Promise<FLAddressChangeSweepResponse> {
  // Left out on a pass's first call: the server takes `after` as an id wherever it is present.
  return addressChangeSweepAddressChange(after === null ? {} : { after });
}

/** The sign-in accounts the effects still owe to carry, for this server alone: the answer names addresses. */
export async function getAddressChangeMoves(): Promise<FLAddressChangeMovesResponse> {
  return addressChangeGetAddressChangeMoves();
}

export async function postAddressChangeMovesDone(payload: FLAddressChangeMovesDonePayload): Promise<FLAddressChangeMovesDoneResponse> {
  return addressChangePostAddressChangeMovesDone(payload);
}

/**
 * The new address of the live change a link's token or a change's id names, on the system tier alone: the link's own read
 * serves no address, and this one reaches this server and never a page.
 */
export async function postAddressChangeAddress(payload: FLAddressChangeAddressPayload): Promise<FLAddressChangeAddressResponse> {
  return addressChangeGetAddressChangeAddress(payload);
}
