import {
  accountDeleteAddressChange,
  accountPostAddressChange,
  accountPostAddressChangeRelease,
  identityPostAccountErasure,
} from "@/core/generated/client/sdk";

import type {
  FLAccountAddressChangeMintResponse,
  FLAccountAddressChangePayload,
  FLAccountAddressChangeReleasePayload,
  FLAccountAddressChangeResponse,
  FLErasureResponse,
} from "@/core/generated/client/types";

/**
 * Erases every league record of the person the request's actor names, the actor and nothing in the body
 * saying whom: the press reaches the library's account deletion only once this has answered.
 */
export async function loeschenEigeneDaten(): Promise<FLErasureResponse> {
  return identityPostAccountErasure();
}

/**
 * The person's own start, under the person lane's actor: the signed-in address names the change, never
 * the body. Its answer holds both tokens, so it never travels past the action that mails them.
 */
export async function beantrageKontoAdresswechsel(payload: FLAccountAddressChangePayload): Promise<FLAccountAddressChangeMintResponse> {
  return accountPostAddressChange(payload);
}

/** The address on file's approval of the change an administrator started without a reason, named by the id its page showed. */
export async function gibKontoAdresswechselFrei(payload: FLAccountAddressChangeReleasePayload): Promise<FLAccountAddressChangeMintResponse> {
  return accountPostAddressChangeRelease(payload);
}

/** The address on file's stop, which hands nothing over and so asks no fresh sign-in. */
export async function stoppeKontoAdresswechsel(): Promise<FLAccountAddressChangeResponse> {
  return accountDeleteAddressChange();
}
