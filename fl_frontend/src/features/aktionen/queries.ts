import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLAktionenListResponseSchema } from "./schemas";

import type { FLAktionenListResponse } from "./schemas";

/**
 * Uncached, as every admin-authed read is — `docs/frontend/spec.md` §1.2. Doubly so here: a row
 * carries the document a write replaced, so a shared entry would hold data from any collection.
 */
export const getAktionen = async (): Promise<FLAktionenListResponse> => {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLAktionenListResponse>("/aktionen", FLAktionenListResponseSchema, { authType: "admin" }),
  );
};
