import { apiClient } from "@/core/api";
import { FLErasureResponseSchema } from "@/core/schemas";

import { FLAbmeldungResponseSchema, FLErasureAnsichtResponseSchema, FLReferenzenResponseSchema } from "./schemas";

import type { FLErasureResponse } from "@/core/schemas";
import type {
  FLAbmeldungPayload,
  FLErasureAnsichtPayload,
  FLErasureAnsichtResponse,
  FLErasurePayload,
  FLReferenzenPayload,
  FLReferenzenResponse,
} from "./schemas";

/**
 * Which of these sign-in addresses no record references, for the account sweep. Here rather than in
 * `queries.ts`, whose reads run inside a person's render: this one answers a timer, which holds no session.
 */
export async function postReferenzen(payload: FLReferenzenPayload): Promise<FLReferenzenResponse> {
  // A POST that reads, the addresses in the body: a query string would put them on the access line.
  return apiClient<FLReferenzenResponse>("/identitaet/referenzen", FLReferenzenResponseSchema, {
    method: "POST",
    readOnly: true,
    // The system tier, not admin: the sweep holds no session, and no actor is invented for a machine.
    authType: "system",
    body: JSON.stringify(payload),
  });
}

/**
 * The address travels in the BODY: a path or a query would file it in the access log and in `aktionen.request.path`.
 * Hence a POST even for the read, a GET's body having no defined semantics (RFC 9110 §9.3.1).
 */
export async function readErasureAnsicht(payload: FLErasureAnsichtPayload): Promise<FLErasureAnsichtResponse> {
  return apiClient<FLErasureAnsichtResponse>("/identitaet/erasure/ansicht", FLErasureAnsichtResponseSchema, {
    method: "POST",
    readOnly: true,
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

/** Erases every league record of the address, the sign-in account left to the caller once this has answered. */
export async function eraseAufAnfrage(payload: FLErasurePayload): Promise<FLErasureResponse> {
  return apiClient<FLErasureResponse>("/identitaet/erasure", FLErasureResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}

/** Files the sign-out on the log, naming no address, before the caller ends a single session. */
export async function recordAbmeldung(payload: FLAbmeldungPayload): Promise<void> {
  await apiClient("/identitaet/abmeldung", FLAbmeldungResponseSchema, {
    method: "POST",
    authType: "admin",
    body: JSON.stringify(payload),
  });
}
