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
}

export interface FLSpieltag {
  id: string;
  name: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  spiele: FLSpiel[];
}

export interface FLSpielplan {
  spieltage: FLSpieltag[];
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

export interface GetSpielePreviewReturn extends BaseApiReturn {
  previous_games: FLSpiel[];
  next_games: FLSpiel[];
}
