import { apiClient } from "@/core/api";

import { FLReferenzenResponseSchema } from "./schemas";

import type { FLReferenzenPayload, FLReferenzenResponse } from "./schemas";

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
