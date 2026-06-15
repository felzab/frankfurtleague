import type { BaseAPIResponse } from "@/core/api";
import { FLSaisonPhase } from "../saisons/types";

export type FLSpieleSortingOptions = "datum" | "uhrzeit" | "spiel_nr" | "saison_phase";
export type FLSpielStatus = "ausstehend" | "vergangen" | "heute" | "abgesagt" | "unbekannt";

export interface FLSpielTeamField {
  team_id: string;
  name: string;
  tore: number | null;
  shorthand: string;
}

export interface FLSpiel {
  id: string;
  team1: FLSpielTeamField;
  team2: FLSpielTeamField;
  datum: string | null;
  uhrzeit: string | null;
  ort: string | null;
  schiedsrichter: string | null;
  mietpreis: number;
  ergebnis: string | null;
  spieltag_id: string;
  spiel_nr: number;
  is_canceled: boolean;
  saison_phase: FLSaisonPhase;
}

export interface FLSpielWithChipData extends FLSpiel {
  status: FLSpielStatus;
}

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

export interface FLSpielplan {
  spieltage: FLSpieltagWithSpiele[];
}

export interface FLSpieleFilterParams {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;
  spiel_status?: FLSpielStatus;
  team_id?: string;

  limit?: number;
  sort_by?: FLSpieleSortingOptions;
  order?: "asc" | "desc";
}
export interface FLSpieleListResponse extends BaseAPIResponse {
  spiele: FLSpiel[];
}
