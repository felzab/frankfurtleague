import { accountDeleteAddressChange, accountPostAddressChange, identityPostAccountErasure } from "@/core/generated/client/sdk";

import type {
  FLAccountAddressChangeMintResponse,
  FLAccountAddressChangePayload,
  FLAccountAddressChangeResponse,
} from "@/core/generated/client/types";

/**
 * The request's actor, never the body, names whose records are erased. The press reaches the library's account
 * deletion only once this has answered.
 */
export async function eraseOwnRecords(): Promise<void> {
  await identityPostAccountErasure();
}

/** The signed-in address names the change, never the body. */
export async function requestAccountAddressChange(payload: FLAccountAddressChangePayload): Promise<FLAccountAddressChangeMintResponse> {
  return accountPostAddressChange(payload);
}

/** The stop hands nothing over, so it asks no fresh sign-in. */
export async function stopAccountAddressChange(): Promise<FLAccountAddressChangeResponse> {
  return accountDeleteAddressChange();
}
