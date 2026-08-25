import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import { FLSpieltageListResponseSchema, FLSpieltageSingleResponseSchema } from "./schemas";

import type { FLSpieltageListResponse, FLSpieltageSingleResponse } from "./schemas";
import type { FLSpieltageFilterParams } from "./types";

export async function getSpieltage(filters: FLSpieltageFilterParams = {}): Promise<FLSpieltageListResponse> {
  "use cache";

  // Base tag only: one matchday write moves both the season-scoped admin list and the public
  // Spielplan's default-season entry, so no granular tag describes it.
  cacheTag("spieltage");
  cacheLife("days");

  return apiClient<FLSpieltageListResponse>("/spieltage", FLSpieltageListResponseSchema, {
    params: filters,
  });
}

/** One in-flight admin matchday read per filter set, held for the length of one render pass. */
const adminSpieltageInFlight = cache((): Map<string, Promise<FLSpieltageListResponse>> => new Map());

/**
 * A season's matchdays for the admin surfaces, a planned season's included — `getSpieltage` refuses
 * that season, though a matchday is dated before it. **Uncached**: `docs/frontend/spec.md` §1.2.
 */
export function getAdminSpieltage(filters: FLSpieltageFilterParams = {}): Promise<FLSpieltageListResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminSpieltageInFlight().get(key);
  if (held !== undefined) return held;

  const started = runWithIncomingCorrelationId(() =>
    apiClient<FLSpieltageListResponse>("/spieltage/list/admin", FLSpieltageListResponseSchema, { authType: "admin", params: filters }),
  );
  adminSpieltageInFlight().set(key, started);

  return started;
}

/**
 * The one matchday the editor loads, admin-tier for `getAdminSpieltage`'s reason. `null` on a 404,
 * which the editor turns into `notFound()`. **Uncached**: `docs/frontend/spec.md` §1.2.
 */
export const getAdminSpieltagById = cache(async (spieltagId: string): Promise<FLSpieltageSingleResponse | null> =>
  runWithIncomingCorrelationId(() =>
    apiClient<FLSpieltageSingleResponse>(`/spieltage/${spieltagId}/admin`, FLSpieltageSingleResponseSchema, { authType: "admin" }).catch(
      (error: unknown) => {
        if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
        throw error;
      },
    ),
  ),
);
