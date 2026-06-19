import type { BaseAPIResponse } from "@/core/api";
import type { FLAddress } from "@/shared/types/sharedTypes";

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
  address: FLAddress;
}

export interface FLTeamCompact {
  id: string;
  name: string;
  statistik: FLTeamStatistik;
  shorthand: string;
  address: FLAddress;
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

export interface FLTeamsFilterParams {
  team_id?: string;
  saison_id?: string;
  gruppe?: string;
  is_disqualified?: boolean;
  in_gruppen?: boolean;
  compact?: boolean;
  include_placeholders?: boolean;

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
