import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLAktionenListResponseSchema } from "./schemas";

import type { FLAktionenListResponse } from "./schemas";

/**
 * Uncached deliberately, as every admin-authed read is — `docs/frontend/spec.md` §1.2. This one could not be cached even
 * if the tier allowed it: a row carries the document a write replaced, so a shared entry would hold data from every
 * collection at once. Being uncached is also what lets it seed the request's correlation scope.
 */
export const getAktionen = async (): Promise<FLAktionenListResponse> => {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLAktionenListResponse>("/aktionen", FLAktionenListResponseSchema, { authType: "admin" }),
  );
};
