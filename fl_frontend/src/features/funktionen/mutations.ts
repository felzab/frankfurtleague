import {
  identitaetGetLoeschungAnsicht,
  identitaetGetReferenzen,
  identitaetPostAbmeldung,
  identitaetPostLoeschung,
} from "@/core/generated/client/sdk";

import type {
  FLLoeschungAdressePayload,
  FLLoeschungAnsichtResponse,
  FLLoeschungPayload,
  FLLoeschungResponse,
  FLReferenzenPayload,
  FLReferenzenResponse,
} from "@/core/generated/client/types";

/**
 * Which of these sign-in addresses no record references, for the account sweep. Here rather than in
 * `queries.ts`, whose reads run inside a person's render: this one answers a timer, which holds no session.
 */
export async function postReferenzen(payload: FLReferenzenPayload): Promise<FLReferenzenResponse> {
  // A POST that reads, the addresses in the body: a query string would put them on the access line.
  return identitaetGetReferenzen(payload, { readOnly: true });
}

/**
 * The address travels in the BODY: a path or a query would file it in the access log and in `aktionen.request.path`.
 * Hence a POST even for the read, a GET's body having no defined semantics (RFC 9110 §9.3.1).
 */
export async function readLoeschungAnsicht(payload: FLLoeschungAdressePayload): Promise<FLLoeschungAnsichtResponse> {
  return identitaetGetLoeschungAnsicht(payload, { readOnly: true });
}

/** Erases every league record of the address, the sign-in account left to the caller once this has answered. */
export async function loeschenAufAnfrage(payload: FLLoeschungPayload): Promise<FLLoeschungResponse> {
  return identitaetPostLoeschung(payload);
}

/** Files the sign-out on the log, naming no address, before the caller ends a single session. */
export async function recordAbmeldung(payload: FLLoeschungAdressePayload): Promise<void> {
  await identitaetPostAbmeldung(payload);
}
