import { cache } from "react";

import { isRecordMissing } from "@/core/errors";
import { spieleGetSpieleVerwaltung, spieleGetSpielVerwaltung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpieleAdminListResponse, FLSpieleAdminSingleResponse, SpieleGetSpieleVerwaltungParams } from "@/core/generated/client/types";

/** One in-flight admin fixture read per filter set, held for the length of one render pass. */
const adminSpieleInFlight = cache((): Map<string, Promise<FLSpieleAdminListResponse>> => new Map());

/**
 * A season's fixtures for the admin surfaces, a planned season's included, which the public read lists as
 * empty. **Uncached, and it stays uncached**.
 */
export function getAdminSpiele(filters: SpieleGetSpieleVerwaltungParams = {}): Promise<FLSpieleAdminListResponse> {
  // Keyed on the filters SERIALIZED, never on the object: React's `cache` compares an argument by
  // identity, so a literal written at the call site would miss every time and memoize nothing.
  const key = JSON.stringify(filters, Object.keys(filters).sort());
  const held = adminSpieleInFlight().get(key);
  if (held !== undefined) return held;

  const started = runAdminRead(() => spieleGetSpieleVerwaltung(filters));
  adminSpieleInFlight().set(key, started);

  return started;
}

/**
 * The one fixture the match editor loads, admin-tier because it round-trips the rent and the
 * referee's Honorar — two figures a base-tier read withholds (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**.
 */

export async function getAdminSpiel(spielId: string): Promise<FLSpieleAdminSingleResponse | null> {
  return runAdminRead(() =>
    // `null` for "no such fixture", which the editor page turns into `notFound()`. Every other
    // status still throws.
    spieleGetSpielVerwaltung(spielId).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  );
}
