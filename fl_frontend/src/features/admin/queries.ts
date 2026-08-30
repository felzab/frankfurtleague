import { apiClient } from "@/core/api";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpieleActionRequiredResponseSchema } from "../spiele/schemas";

import type { FLSpieleActionRequiredResponse } from "../spiele/schemas";

/**
 * Uncached deliberately, as every admin-authed read is — `docs/frontend/spec.md`. Being uncached is
 * also what lets it seed the request's correlation scope.
 */
export const getAdminSpieleActionRequired = async (filters: { saison_id?: string } = {}): Promise<FLSpieleActionRequiredResponse> => {
  return runWithIncomingCorrelationId(() =>
    // `saison_id` is optional on the wire so no other caller moves, but this page always sends one:
    // an unscoped triage list left the season selector visibly doing nothing.
    apiClient<FLSpieleActionRequiredResponse>("/spiele/action_required", FLSpieleActionRequiredResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
};
