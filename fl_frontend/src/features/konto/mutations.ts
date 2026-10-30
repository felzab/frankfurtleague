import {
  identitaetEraseSelbst,
  kontoDeleteAdresswechsel,
  kontoPostAdresswechsel,
  kontoPostAdresswechselFreigabe,
} from "@/core/generated/client/sdk";

import type {
  FLErasureResponse,
  FLKontoAdresswechselFreigabePayload,
  FLKontoAdresswechselFreigabeResponse,
  FLKontoAdresswechselMintResponse,
  FLKontoAdresswechselPayload,
  FLKontoAdresswechselResponse,
} from "@/core/generated/client/types";

/**
 * Erases every league record of the person the request's actor names, the actor and nothing in the body
 * saying whom: the press reaches the library's account deletion only once this has answered.
 */
export async function eraseEigeneDaten(): Promise<FLErasureResponse> {
  return identitaetEraseSelbst();
}

/**
 * The person's own start, under the person lane's actor: the signed-in address names the change, never
 * the body. Its answer holds both tokens, so it never travels past the action that mails them.
 */
export async function beantrageKontoAdresswechsel(payload: FLKontoAdresswechselPayload): Promise<FLKontoAdresswechselMintResponse> {
  return kontoPostAdresswechsel(payload);
}

/** The address on file's approval of the change an administrator started without a reason, named by the id its page showed. */
export async function gibKontoAdresswechselFrei(payload: FLKontoAdresswechselFreigabePayload): Promise<FLKontoAdresswechselFreigabeResponse> {
  return kontoPostAdresswechselFreigabe(payload);
}

/** The address on file's stop, which hands nothing over and so asks no fresh sign-in. */
export async function stoppeKontoAdresswechsel(): Promise<FLKontoAdresswechselResponse> {
  return kontoDeleteAdresswechsel();
}
