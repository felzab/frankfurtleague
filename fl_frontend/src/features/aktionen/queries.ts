import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLAktionenListResponseSchema } from "./schemas";

import type { FLAktionenListResponse } from "./schemas";

/**
 * Uncached, as every admin-authed read is — `docs/frontend/spec.md` §1.2. `documentId` narrows to
 * one document's history; `apiClient` drops an undefined param, so absent means the whole log.
 */
export const getAktionen = async (documentId?: string): Promise<FLAktionenListResponse> => {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLAktionenListResponse>("/aktionen", FLAktionenListResponseSchema, {
      authType: "admin",
      params: { document_id: documentId },
    }),
  );
};
