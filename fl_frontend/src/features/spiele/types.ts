import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLSpielStatus } from "./schemas";

/**
 * **Declared here rather than in `admin`, because it classifies a Spiel**: the edit page reads the
 * classification too, and a type in `admin` would make `spiele` depend on the aggregator.
 */
export type ActionRequiredCategory =
  | "ergebnis_pending"
  | "besetzung_missing"
  | "bracket_fault"
  | "datum_missing"
  | "uhrzeit_missing"
  | "ort_missing"
  | "schiedsrichter_missing"
  | "abgesagt";

type FLSpieleSortingOptions = "datum" | "uhrzeit" | "spiel_nr" | "saison_phase";

export type FLSpieleFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;
  spiel_status?: FLSpielStatus;
  team_id?: string;

  limit?: number;
  sort_by?: FLSpieleSortingOptions;
  order?: "asc" | "desc";
};
