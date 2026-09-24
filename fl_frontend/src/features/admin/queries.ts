import { apiClient } from "@/core/api";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { FLSpieleActionRequiredResponseSchema } from "../spiele/schemas";

import type { FLSpieleActionRequiredResponse } from "../spiele/schemas";

/**
 * Uncached deliberately, as every admin-authed read is — `docs/frontend/spec.md`. Being uncached is
 * also what lets it seed the request's trace scope.
 */
export const getAdminSpieleActionRequired = async (filters: { saison_id?: string } = {}): Promise<FLSpieleActionRequiredResponse> => {
  return runWithIncomingTrace(() =>
    // Optional because `fl_frontend/src/app/admin/(current-saison)/action_required/page.tsx` omits it for the
    // running season, and the backend resolves an omitted one to the active season (`docs/backend/spec.md :: I4`).
    apiClient<FLSpieleActionRequiredResponse>("/spiele/action_required", FLSpieleActionRequiredResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
};
