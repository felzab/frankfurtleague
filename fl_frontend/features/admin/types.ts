import type { BaseApiReturn } from "@/core/api";
import type { FLSpiel, FLSpielTeamField } from "../spiele/types";

export interface AdminSpieleOverview {
  unaktuelle_spiele: FLSpiel[];
  spiele_ohne_uhrzeit: FLSpiel[];
  spiele_ohne_ort: FLSpiel[];
}

export interface GetAdminSpieleOverviewReturn extends BaseApiReturn {
  spiele_overview: FLSpiel[];
}

export interface PatchAdminSpielDataReturn extends BaseApiReturn {}

export interface PatchAdminSpielDataPayload {
  datum: string;
  uhrzeit: string;
  ort: string;
  schiedsrichter: string;
  mietpreis: number;
  team1: FLSpielTeamField;
  team2: FLSpielTeamField;
  spiel_id: string;
}
