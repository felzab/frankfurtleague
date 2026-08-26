import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpieleAdminSingleResponseSchema, FLSpieleListResponseSchema } from "./schemas";

import type { FLSpieleAdminSingleResponse, FLSpieleListResponse } from "./schemas";
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

/** One in-flight admin fixture read per filter set, held for the length of one render pass. */
const adminSpieleInFlight = cache((): Map<string, Promise<FLSpieleListResponse>> => new Map());

/**
 * A season's fixtures for the admin surfaces, a planned season's included — `getSpiele` lists that
 * season as empty. **Uncached, and it stays uncached**: `docs/frontend/spec.md` §1.2.
 */
export function getAdminSpiele(filters: FLSpieleFilterParams = {}): Promise<FLSpieleListResponse> {
  // Keyed on the filters SERIALIZED, never on the object: React's `cache` compares an argument by
  // identity, so a literal written at the call site would miss every time and memoize nothing.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminSpieleInFlight().get(key);
  if (held !== undefined) return held;

  const started = runWithIncomingCorrelationId(() =>
    apiClient("/spiele/list/admin", FLSpieleListResponseSchema, { authType: "admin", params: filters }),
  );
  adminSpieleInFlight().set(key, started);

  return started;
}

/**
 * The one fixture the match editor loads, admin-tier because it round-trips the rent and the
 * referee's Honorar — two figures a base-tier read withholds (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**: see `docs/frontend/spec.md` §1.2.
 */

export async function getAdminSpiel(spielId: string): Promise<FLSpieleAdminSingleResponse | null> {
  return runWithIncomingCorrelationId(() =>
    // `null` for "no such fixture", which the editor page turns into `notFound()`. Every other
    // status still throws.
    apiClient(`/spiele/${spielId}/admin`, FLSpieleAdminSingleResponseSchema, { authType: "admin" }).catch((error: unknown) => {
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
  );
}
