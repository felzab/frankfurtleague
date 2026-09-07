import { apiClient } from "@/core/api";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { FLAktionenListResponseSchema } from "./schemas";

import type { FLAktionenListResponse } from "./schemas";

/**
 * Uncached, as every admin-authed read is — `docs/frontend/spec.md` §1.2. `document_id` narrows to
 * one document's history; an omitted key means the whole log.
 */
export const getAktionen = async (filters: { document_id?: string } = {}): Promise<FLAktionenListResponse> => {
  return runWithIncomingTrace(() =>
    apiClient<FLAktionenListResponse>("/aktionen", FLAktionenListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
};
