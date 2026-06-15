import type { FLSaisonPhase, FLSpiel } from "../spiele/types";

export type FLSpieltageSortingOptions = "beginn" | "ende" | "anzahl_spiele" | "order_val";

export interface FLSpieltag {
  id: string;
  name: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  order_val: number;
  saison_phase: FLSaisonPhase;
}

export interface FLSpieltagWithSpiele extends FLSpieltag {
  spiele: FLSpiel[];
}
export interface FLSpieltageFilterParams {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;

  limit?: number;
  sort_by?: FLSpieltageSortingOptions;
  order?: "asc" | "desc";
}

export interface FLSpieltageListResponse {
  spieltage: FLSpieltag[];
}
