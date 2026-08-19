import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpieleActionRequiredResponseSchema } from "../spiele/schemas";

import type { FLSpieleActionRequiredResponse } from "../spiele/schemas";

/**
 * Uncached deliberately, as every admin-authed read is — `docs/frontend/spec.md`. Being uncached is
 * also what lets it seed the request's correlation scope.
 */
export const getAdminSpieleActionRequired = async (): Promise<FLSpieleActionRequiredResponse> => {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLSpieleActionRequiredResponse>("/spiele/action_required", FLSpieleActionRequiredResponseSchema, { authType: "admin" }),
  );
};
