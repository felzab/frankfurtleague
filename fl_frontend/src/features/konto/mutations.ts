import { apiClient } from "@/core/api";
import { FLErasureResponseSchema } from "@/core/schemas";

import {
  FLKontoAdresswechselFreigabeResponseSchema,
  FLKontoAdresswechselMintResponseSchema,
  FLKontoAdresswechselResponseSchema,
} from "./schemas";

import type { FLErasureResponse } from "@/core/schemas";
import type {
  FLKontoAdresswechselFreigabeResponse,
  FLKontoAdresswechselMintResponse,
  FLKontoAdresswechselPayload,
  FLKontoAdresswechselResponse,
} from "./schemas";

/**
 * Erases every league record of the person the request's actor names, the actor and nothing in the body
 * saying whom: the press reaches the library's account deletion only once this has answered.
 */
export async function eraseEigeneDaten(): Promise<FLErasureResponse> {
  return apiClient<FLErasureResponse>("/identitaet/selbst/erasure", FLErasureResponseSchema, { method: "POST", authType: "admin" });
}

/**
 * The person's own start, under the person lane's actor: the signed-in address names the change, never
 * the body. Its answer holds both tokens, so it never travels past the action that mails them.
 */
export async function beantrageKontoAdresswechsel(payload: FLKontoAdresswechselPayload): Promise<FLKontoAdresswechselMintResponse> {
  return apiClient<FLKontoAdresswechselMintResponse>("/konto/adresswechsel", FLKontoAdresswechselMintResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

/** The address on file's approval of a change an administrator started without a reason. */
export async function gibKontoAdresswechselFrei(): Promise<FLKontoAdresswechselFreigabeResponse> {
  return apiClient<FLKontoAdresswechselFreigabeResponse>("/konto/adresswechsel/freigabe", FLKontoAdresswechselFreigabeResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/** The address on file's stop, which hands nothing over and so asks no fresh sign-in. */
export async function stoppeKontoAdresswechsel(): Promise<FLKontoAdresswechselResponse> {
  return apiClient<FLKontoAdresswechselResponse>("/konto/adresswechsel", FLKontoAdresswechselResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}
