import { cache } from "react";

import { spieltageGetSpieltageVerwaltung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpieltageListResponse, SpieltageGetSpieltageVerwaltungParams } from "@/core/generated/client/types";

/** One in-flight admin matchday read per filter set, held for the length of one render pass. */
const adminSpieltageInFlight = cache((): Map<string, Promise<FLSpieltageListResponse>> => new Map());

/**
 * A season's matchdays for the admin surfaces, a planned season's included, though the public reads refuse
 * that season: a matchday is dated before it. **Uncached**.
 */
export function getAdminSpieltage(filters: SpieltageGetSpieltageVerwaltungParams = {}): Promise<FLSpieltageListResponse> {
  // Keyed on the filters SERIALIZED, for the reason `fl_frontend/src/features/spiele/queries.ts :: getAdminSpiele` gives.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminSpieltageInFlight().get(key);
  if (held !== undefined) return held;

  const started = runAdminRead(() => spieltageGetSpieltageVerwaltung(filters));
  adminSpieltageInFlight().set(key, started);

  return started;
}
