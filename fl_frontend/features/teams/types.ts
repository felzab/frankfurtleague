import type { BaseAPIResponse } from "@/core/api";
import type { FLSpiel } from "../spiele/types";

export type FLTeamsSortingOptions = "name";

export interface FLSpieler {
  id: string;
  vorname: string;
  nachname: string;
  stufe: string;
  nummer: number;
  position: string;
  nachgetragen: boolean;
  team_id: string;
}

export interface FLTeamStatistik {
  anzahl_gespielte_spiele: number;
  siege: number;
  niederlagen: number;
  unentschieden: number;
  tore_geschossen: number;
  tore_kassiert: number;
  punkte: number;
}

export interface FLTeamAddress {
  strasse: string;
  hausnummer: string;
  plz: string;
  stadtteil: string;
  stadt: string;
}
export interface FLTeam {
  id: string;
  name: string;
  gruppe: 2026;
  statistik: FLTeamStatistik;
  is_placeholder: boolean;
  is_disqualified: boolean;
  shorthand: string;
  description: string;
  full_name: string;
  website_url: string;
  address: FLTeamAddress;
}

export interface FLTeamCompact {
  id: string;
  name: string;
  statistik: FLTeamStatistik;
  shorthand: string;
  address: FLTeamAddress;
}

export interface FLTeamWithSpieler extends FLTeam {
  spieler: FLSpieler[];
}

export interface FLGruppen {
  A: FLTeam[];
  B: FLTeam[];
  C: FLTeam[];
  D: FLTeam[];
}

export interface GetSaisontabelleReturn extends BaseAPIResponse {
  gruppen: FLGruppen;
}

export interface GetAllTeamsWithSpielerReturn extends BaseAPIResponse {
  teams: FLTeamWithSpieler[];
}

export interface GetAllTeamsReturn extends BaseAPIResponse {
  teams: FLTeam[];
}

export interface GetAllTeamsCompactReturn extends BaseAPIResponse {
  teams_compact: FLTeamCompact[];
}

export interface GetTeamDetailsByIdReturn extends BaseAPIResponse {
  team_details: FLTeam;
  team_spiele: FLSpiel[];
}

export interface GetTeamSpielerById extends BaseAPIResponse {
  team_compact: FLTeamCompact;
  team_spieler: FLSpieler[];
}

export interface FLTeamsFilterParams {
  team_id?: string;
  saison_id?: string;
  gruppe?: string;
  is_placeholder?: boolean;
  is_disqualified?: boolean;
  in_gruppen?: boolean;
  compact?: boolean;

  limit?: number;
  sort_by?: FLTeamsSortingOptions;
  order?: "asc" | "desc";
}

export interface FLTeamsListResponse extends BaseAPIResponse {
  format: "list";
  teams: FLTeam[];
}

export interface FLTeamsCompactListResponse extends BaseAPIResponse {
  format: "compact";
  teams: FLTeamCompact[];
}

export interface FLTeamsGruppenResponse extends BaseAPIResponse {
  format: "grouped";
  gruppen: FLGruppen;
}

export type FLTeamsResponse = FLTeamsListResponse | FLTeamsGruppenResponse | FLTeamsCompactListResponse;
