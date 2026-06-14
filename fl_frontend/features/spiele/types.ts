import type { BaseApiReturn } from "@/core/api";

export interface FLSpielTeamField {
  team_id: string | null;
  name: string;
  tore: number | null;
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
}

export interface FLSpielWithChipData extends FLSpiel {
  status: SpielStatus;
  phase: SpielPhase;
}

export interface FLSpieltag {
  id: string;
  name: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  order_val: number;
}

export type SpielStatus = "ausstehend" | "vergangen" | "heute" | "abgesagt" | "unbekannt";
export type SpielPhase = "gruppenphase" | "viertelfinale" | "halbfinale" | "finale";

export interface FLSpieltagWithSpiele extends FLSpieltag {
  spiele: FLSpiel[];
}

export interface FLSpielplan {
  spieltage: FLSpieltagWithSpiele[];
}

export interface GetSpielplanReturn extends BaseApiReturn {
  spielplan: FLSpielplan;
}

export interface GetSpielhistorieReturn extends BaseApiReturn {
  spielhistorie: FLSpiel[];
}

export interface GetAllSpieleReturn extends BaseApiReturn {
  all_spiele: FLSpiel[];
}

export interface GetRecentAndUpcomingSpieleReturn extends BaseApiReturn {
  recent_spiele: FLSpiel[];
  upcoming_spiele: FLSpiel[];
}
