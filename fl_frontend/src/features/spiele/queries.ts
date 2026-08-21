import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpieleListResponseSchema, FLSpieleSingleResponseSchema } from "./schemas";

import type { FLSpieleListResponse, FLSpieleSingleResponse } from "./schemas";
import type { FLSpieleFilterParams } from "./types";

export async function getSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  "use cache";

  // The only granular tag, and `actions.ts` has its matching `updateTag`. None by phase or status:
  // a result edit changes a match's status, so both the old and new value would have to invalidate.
  const tags: string[] = ["spiele"];
  if (filters.saison_id) tags.push(`spiele:saison_id:${filters.saison_id}`);
  cacheTag(...tags);
  cacheLife("hours");

  return apiClient("/spiele", FLSpieleListResponseSchema, {
    params: filters,
  });
}

/**
 * The one fixture the match editor loads, admin-tier so it stays correct once the rent and the
 * referee's Entschädigung come off the public reads (`docs/backend/spec.md` §4).
 *
 * **Uncached, and it stays uncached**: see `docs/frontend/spec.md` §1.2.
 */

export async function getAdminSpiel(spielId: string): Promise<FLSpieleSingleResponse | null> {
  return runWithIncomingCorrelationId(() =>
    // `null` for "no such fixture", which the editor page turns into `notFound()`. Every other
    // status still throws.
    apiClient(`/spiele/${spielId}/admin`, FLSpieleSingleResponseSchema, { authType: "admin" }).catch((error: unknown) => {
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
  );
}
