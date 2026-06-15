import type { BaseAPIResponse } from "@/core/api";

export type FLSpieleSortingOptions = "datum" | "uhrzeit" | "spiel_nr" | "saison_phase";

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
export type FLSpielStatus = "ausstehend" | "vergangen" | "heute" | "abgesagt" | "unbekannt";
export type FLSaisonPhase = "gruppenphase" | "viertelfinale" | "halbfinale" | "finale";

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

export interface GetSpielplanReturn extends BaseAPIResponse {
  spielplan: FLSpielplan;
}

export interface GetSpielhistorieReturn extends BaseAPIResponse {
  spielhistorie: FLSpiel[];
}

export interface GetAllSpieleReturn extends BaseAPIResponse {
  all_spiele: FLSpiel[];
}

export interface GetRecentAndUpcomingSpieleReturn extends BaseAPIResponse {
  recent_spiele: FLSpiel[];
  upcoming_spiele: FLSpiel[];
}

export interface GetPlayoffsSpieleReturn extends BaseAPIResponse {
  playoffs_spieltage: FLSpieltagWithSpiele[];
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
