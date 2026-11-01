import { identityGetErasureView, identityGetReferences, identityPostErasure, identityPostSignOut } from "@/core/generated/client/sdk";

import type {
  FLErasureAdressePayload,
  FLErasurePayload,
  FLErasureResponse,
  FLErasureViewResponse,
  FLReferencesPayload,
  FLReferencesResponse,
} from "@/core/generated/client/types";

/**
 * Which of these sign-in addresses no record references, for the account sweep. Here rather than in
 * `queries.ts`, whose reads run inside a person's render: this one answers a timer, which holds no session.
 */
export async function postReferenzen(payload: FLReferencesPayload): Promise<FLReferencesResponse> {
  // A POST that reads, the addresses in the body: a query string would put them on the access line.
  return identityGetReferences(payload, { readOnly: true });
}

/**
 * The address travels in the BODY: a path or a query would file it in the access log and in `aktionen.request.path`.
 * Hence a POST even for the read, a GET's body having no defined semantics (RFC 9110 §9.3.1).
 */
export async function readLoeschungAnsicht(payload: FLErasureAdressePayload): Promise<FLErasureViewResponse> {
  return identityGetErasureView(payload, { readOnly: true });
}

/** Erases every league record of the address, the sign-in account left to the caller once this has answered. */
export async function loeschenAufAnfrage(payload: FLErasurePayload): Promise<FLErasureResponse> {
  return identityPostErasure(payload);
}

/** Files the sign-out on the log, naming no address, before the caller ends a single session. */
export async function recordAbmeldung(payload: FLErasureAdressePayload): Promise<void> {
  await identityPostSignOut(payload);
}
