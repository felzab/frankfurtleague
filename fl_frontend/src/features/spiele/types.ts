import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLSpielStatus } from "./schemas";

export type FLSpieleSortingOptions = "datum" | "uhrzeit" | "spiel_nr" | "saison_phase";

export type FLSpieleFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;
  spiel_status?: FLSpielStatus;
  team_id?: string;

  limit?: number;
  sort_by?: FLSpieleSortingOptions;
  order?: "asc" | "desc";
};
