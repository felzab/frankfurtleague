/**
 * SPIELTAGE · query parameter types
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * `saison_phase` widens the stored enum with `"playoffs"`, which is a query-only alias meaning "any
 * phase except gruppenphase". It is valid to send and never valid to receive.
 */

import type { FLSaisonPhase } from "../saisons/schemas";

export type FLSpieltageSortingOptions = "beginn" | "ende" | "anzahl_spiele" | "order_val";

export type FLSpieltageFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;

  limit?: number;
  sort_by?: FLSpieltageSortingOptions;
  order?: "asc" | "desc";
};
