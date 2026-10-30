import {
  schiedsrichterDeleteSchiedsrichter,
  schiedsrichterEinladenSchiedsrichter,
  schiedsrichterGetBestaetigungAnsicht,
  schiedsrichterPatchEinwilligung,
  schiedsrichterPatchSchiedsrichter,
  schiedsrichterPostBestaetigung,
  schiedsrichterPostSchiedsrichter,
  schiedsrichterReactivateSchiedsrichter,
} from "@/core/generated/client/sdk";

import type {
  FLPatchSchiedsrichterResponse,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLSchiedsrichterBestaetigungAnsichtResponse,
  FLSchiedsrichterBestaetigungPayload,
  FLSchiedsrichterBestaetigungResponse,
  FLSchiedsrichterMintResponse,
  FLSchiedsrichterReactivateResponse,
  FLSchiedsrichterSelbstEinwilligungResponse,
  FLSchiedsrichterWriteResponse,
  FLSelbstEinwilligungPayload,
  FLTokenPayload,
} from "@/core/generated/client/types";
import type { FLPatchSchiedsrichterPayload, FLSchiedsrichterEinladenPayload, FLSchiedsrichterKeyPayload } from "./schemas";

export async function postSchiedsrichter(postSchiedsrichterPayload: FLPostSchiedsrichterPayload): Promise<FLPostSchiedsrichterResponse> {
  return schiedsrichterPostSchiedsrichter(postSchiedsrichterPayload);
}

/** The id goes in the path, never the body: the backend model refuses a body that names one. */
export async function patchSchiedsrichter({ id, ...fields }: FLPatchSchiedsrichterPayload): Promise<FLPatchSchiedsrichterResponse> {
  return schiedsrichterPatchSchiedsrichter(id, fields);
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterWriteResponse> {
  return schiedsrichterDeleteSchiedsrichter(id);
}

// Clearing `inactive_since` returns the referee to the picker and to every default read, which makes
// retirement a state rather than a disappearance.
export async function reactivateSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterReactivateResponse> {
  return schiedsrichterReactivateSchiedsrichter(id);
}

// Replaces the whole bookkeeping block, so the previous token stops working at once and the
// delivery state of the message it went out in goes with it.
export async function einladeSchiedsrichter({ id }: FLSchiedsrichterEinladenPayload): Promise<FLSchiedsrichterMintResponse> {
  return schiedsrichterEinladenSchiedsrichter(id);
}

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postSchiedsrichterBestaetigungAnsicht(payload: FLTokenPayload): Promise<FLSchiedsrichterBestaetigungAnsichtResponse> {
  return schiedsrichterGetBestaetigungAnsicht(payload, { readOnly: true });
}

/**
 * The referee's own press. `base`, not `admin`: the token in the body is the whole authorization,
 * and an admin key on this call would make the public page a route into the admin tier.
 */
export async function postSchiedsrichterBestaetigung(
  payload: FLSchiedsrichterBestaetigungPayload,
): Promise<FLSchiedsrichterBestaetigungResponse> {
  return schiedsrichterPostBestaetigung(payload);
}

// The referee's own press on the account page, under the person lane's actor; the record is named in
// the path because one address may hold several referee rows.
export async function patchSchiedsrichterSelbstEinwilligung(
  schiedsrichterId: string,
  payload: FLSelbstEinwilligungPayload,
): Promise<FLSchiedsrichterSelbstEinwilligungResponse> {
  return schiedsrichterPatchEinwilligung(schiedsrichterId, payload);
}
