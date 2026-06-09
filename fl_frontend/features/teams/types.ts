import type { BaseApiReturn } from "@/core/api";

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
}

export interface FLTeamWithSpieler extends FLTeam {
  spieler?: FLSpieler[];
}

export interface FLGruppen {
  A: FLTeam[];
  B: FLTeam[];
  C: FLTeam[];
  D: FLTeam[];
}

export interface GetSaisontabelleReturn extends BaseApiReturn {
  gruppen: FLGruppen;
}

export interface GetAllTeamsWithSpielerReturn extends BaseApiReturn {
  teams: FLTeamWithSpieler[];
}

export interface GetAllTeamsReturn extends BaseApiReturn {
  teams: FLTeam[];
}
