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
 * The one fixture the match editor loads, admin-tier so it stays correct when `REQ-READ-001` takes
 * the rent and the referee's Entschädigung off the public reads.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments and never on caller identity,
 * so one shared entry would be a slot of admin-authorized data any caller could reach. What it buys
 * today is freshness rather than confinement — the editor seeds from the fixture as it stands, so a
 * save cannot write back a copy that went stale in a cache. Nothing projects per caller,
 * since a response whose shape follows the credential cannot be mirrored in Zod. Being uncached is
 * also what lets it seed the request's correlation scope.
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
