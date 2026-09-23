import { apiClient } from "@/core/api";

import {
  FLPatchSchiedsrichterResponseSchema,
  FLPostSchiedsrichterResponseSchema,
  FLSchiedsrichterBestaetigungAnsichtResponseSchema,
  FLSchiedsrichterBestaetigungResponseSchema,
  FLSchiedsrichterMintResponseSchema,
  FLSchiedsrichterReactivateResponseSchema,
  FLSchiedsrichterWriteResponseSchema,
} from "./schemas";

import type {
  FLAnonymiseSchiedsrichterPayload,
  FLPatchSchiedsrichterPayload,
  FLPatchSchiedsrichterResponse,
  FLPostSchiedsrichterPayload,
  FLPostSchiedsrichterResponse,
  FLSchiedsrichterBestaetigungAnsichtPayload,
  FLSchiedsrichterBestaetigungAnsichtResponse,
  FLSchiedsrichterBestaetigungPayload,
  FLSchiedsrichterBestaetigungResponse,
  FLSchiedsrichterEinladenPayload,
  FLSchiedsrichterKeyPayload,
  FLSchiedsrichterMintResponse,
  FLSchiedsrichterReactivateResponse,
  FLSchiedsrichterWriteResponse,
} from "./schemas";

export async function postSchiedsrichter(postSchiedsrichterPayload: FLPostSchiedsrichterPayload): Promise<FLPostSchiedsrichterResponse> {
  return apiClient<FLPostSchiedsrichterResponse>("/schiedsrichter", FLPostSchiedsrichterResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(postSchiedsrichterPayload),
  });
}

/** The id goes in the path, never the body: the backend model refuses a body that names one. */
export async function patchSchiedsrichter({ id, ...fields }: FLPatchSchiedsrichterPayload): Promise<FLPatchSchiedsrichterResponse> {
  return apiClient<FLPatchSchiedsrichterResponse>(`/schiedsrichter/${id}`, FLPatchSchiedsrichterResponseSchema, {
    method: "PATCH",
    authType: "admin",
    body: JSON.stringify(fields),
  });
}

// Soft: the backend stamps `inactive_since` and removes nothing.
export async function deleteSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterWriteResponse> {
  return apiClient<FLSchiedsrichterWriteResponse>(`/schiedsrichter/${id}`, FLSchiedsrichterWriteResponseSchema, {
    method: "DELETE",
    authType: "admin",
  });
}

// Clearing `inactive_since` returns the referee to the picker and to every default read, which makes
// retirement a state rather than a disappearance.
export async function reactivateSchiedsrichter({ id }: FLSchiedsrichterKeyPayload): Promise<FLSchiedsrichterReactivateResponse> {
  return apiClient<FLSchiedsrichterReactivateResponse>(`/schiedsrichter/${id}/reactivate`, FLSchiedsrichterReactivateResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

// Deletes the row and repoints every fixture that named them at the ghost, in one transaction. The
// echoed document is the GHOST: the person's row is gone, so no caller may read one back off this.
export async function anonymiseSchiedsrichter({ id }: FLAnonymiseSchiedsrichterPayload): Promise<FLSchiedsrichterWriteResponse> {
  return apiClient<FLSchiedsrichterWriteResponse>(`/schiedsrichter/${id}/anonymisieren`, FLSchiedsrichterWriteResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

// Replaces the whole bookkeeping block, so the previous token stops working at once and the
// delivery state of the message it went out in goes with it.
export async function einladeSchiedsrichter({ id }: FLSchiedsrichterEinladenPayload): Promise<FLSchiedsrichterMintResponse> {
  return apiClient<FLSchiedsrichterMintResponse>(`/schiedsrichter/${id}/bestaetigung/einladen`, FLSchiedsrichterMintResponseSchema, {
    method: "POST",
    authType: "admin",
  });
}

/**
 * A POST that reads. The token is the credential, and a GET would put it in a query string the
 * backend's own route template does not redact.
 */
export async function postSchiedsrichterBestaetigungAnsicht(
  payload: FLSchiedsrichterBestaetigungAnsichtPayload,
): Promise<FLSchiedsrichterBestaetigungAnsichtResponse> {
  return apiClient<FLSchiedsrichterBestaetigungAnsichtResponse>(
    "/schiedsrichter/bestaetigung/ansicht",
    FLSchiedsrichterBestaetigungAnsichtResponseSchema,
    { method: "POST", readOnly: true, authType: "base", body: JSON.stringify(payload) },
  );
}

/**
 * The referee's own press. `base`, not `admin`: the token in the body is the whole authorization,
 * and an admin key on this call would make the public page a route into the admin tier.
 */
export async function postSchiedsrichterBestaetigung(
  payload: FLSchiedsrichterBestaetigungPayload,
): Promise<FLSchiedsrichterBestaetigungResponse> {
  return apiClient<FLSchiedsrichterBestaetigungResponse>("/schiedsrichter/bestaetigung", FLSchiedsrichterBestaetigungResponseSchema, {
    method: "POST",
    authType: "base",
    body: JSON.stringify(payload),
  });
}
