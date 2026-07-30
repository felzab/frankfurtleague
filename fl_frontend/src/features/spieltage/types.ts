import type { FLSaisonPhase } from "../saisons/schemas";

export type FLSpieltageSortingOptions = "beginn" | "ende" | "anzahl_spiele" | "order_val";

export type FLSpieltageFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;

  limit?: number;
  sort_by?: FLSpieltageSortingOptions;
  order?: "asc" | "desc";
};
