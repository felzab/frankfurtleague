import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { isRecordMissing } from "@/core/errors";
import { spieltageGetSpieltage, spieltageGetSpieltageForAdmin, spieltageGetSpieltagForAdmin } from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";
import { runAdminRead } from "@/shared/utils/adminRead";

import type {
  FLSpieltageListResponse,
  FLSpieltageSingleResponse,
  SpieltageGetSpieltageForAdminParams,
  SpieltageGetSpieltageParams,
} from "@/core/generated/client/types";

export async function getSpieltage(filters: SpieltageGetSpieltageParams = {}): Promise<FLSpieltageListResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return spieltageGetSpieltage(filters);
}

/** One in-flight admin matchday read per filter set, held for the length of one render pass. */
const adminSpieltageInFlight = cache((): Map<string, Promise<FLSpieltageListResponse>> => new Map());

/**
 * A season's matchdays for the admin surfaces, a planned season's included — `getSpieltage` refuses
 * that season, though a matchday is dated before it. **Uncached**.
 */
export function getAdminSpieltage(filters: SpieltageGetSpieltageForAdminParams = {}): Promise<FLSpieltageListResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminSpieltageInFlight().get(key);
  if (held !== undefined) return held;

  const started = runAdminRead(() => spieltageGetSpieltageForAdmin(filters));
  adminSpieltageInFlight().set(key, started);

  return started;
}

/**
 * The one matchday the editor loads, admin-tier for `getAdminSpieltage`'s reason. `null` on a 404,
 * which the editor turns into `notFound()`. **Uncached**.
 */
export const getAdminSpieltagById = cache(async (spieltagId: string): Promise<FLSpieltageSingleResponse | null> =>
  runAdminRead(() =>
    spieltageGetSpieltagForAdmin(spieltagId).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  ),
);
