import {
  schiedsrichterGetConfirmationView,
  schiedsrichterPatchEinwilligung,
  schiedsrichterPostConfirmation,
  schiedsrichterPostSchiedsrichter,
} from "@/core/generated/client/sdk";

import type {
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLSchiedsrichterAccountEinwilligungPayload,
  FLSchiedsrichterConfirmationPayload,
  FLSchiedsrichterConfirmationResponse,
  FLSchiedsrichterConfirmationViewResponse,
  FLTokenPayload,
} from "@/core/generated/client/types";

export async function postSchiedsrichter(postSchiedsrichterPayload: FLPostSchiedsrichterPayload): Promise<FLPostSchiedsrichterResponse> {
  return schiedsrichterPostSchiedsrichter(postSchiedsrichterPayload);
}

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postSchiedsrichterBestaetigungAnsicht(payload: FLTokenPayload): Promise<FLSchiedsrichterConfirmationViewResponse> {
  return schiedsrichterGetConfirmationView(payload);
}

/**
 * The referee's own press. `base`, not `admin`: the token in the body is the whole authorization,
 * and an admin key on this call would make the public page a route into the admin tier.
 */
export async function postSchiedsrichterBestaetigung(
  payload: FLSchiedsrichterConfirmationPayload,
): Promise<FLSchiedsrichterConfirmationResponse> {
  return schiedsrichterPostConfirmation(payload);
}

// The referee's own press on the account page, under the person lane's actor; the record is named in
// the path because one address may hold several referee rows.
export async function patchSchiedsrichterKontoEinwilligung(
  schiedsrichterId: string,
  payload: FLSchiedsrichterAccountEinwilligungPayload,
): Promise<void> {
  return schiedsrichterPatchEinwilligung(schiedsrichterId, payload);
}
