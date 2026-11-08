import { identityGetReferences } from "@/core/generated/client/sdk";

import type { FLReferencesPayload, FLReferencesResponse } from "@/core/generated/client/types";

/**
 * Which of these sign-in addresses no record references, for the account sweep. Here rather than in
 * `queries.ts`, whose reads run inside a person's render: this one answers a timer, which holds no session.
 */
export async function postReferenzen(payload: FLReferencesPayload): Promise<FLReferencesResponse> {
  // A POST that reads, the addresses in the body: a query string would put them on the access line.
  return identityGetReferences(payload);
}
