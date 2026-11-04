import { accountDeleteAddressChange, accountPostAddressChange, identityPostAccountErasure } from "@/core/generated/client/sdk";

import type {
  FLAccountAddressChangeMintResponse,
  FLAccountAddressChangePayload,
  FLAccountAddressChangeResponse,
  FLErasureResponse,
} from "@/core/generated/client/types";

/**
 * Erases every league record of the person the request's actor names, the actor and nothing in the body
 * saying whom: the press reaches the library's account deletion only once this has answered.
 */
export async function eraseOwnRecords(): Promise<FLErasureResponse> {
  return identityPostAccountErasure();
}

/**
 * The person's own start, under the person lane's actor: the signed-in address names the change, never
 * the body. Its answer holds both tokens, so it never travels past the action that mails them.
 */
export async function requestAccountAddressChange(payload: FLAccountAddressChangePayload): Promise<FLAccountAddressChangeMintResponse> {
  return accountPostAddressChange(payload);
}

/** The address on file's stop, which hands nothing over and so asks no fresh sign-in. */
export async function stopAccountAddressChange(): Promise<FLAccountAddressChangeResponse> {
  return accountDeleteAddressChange();
}
