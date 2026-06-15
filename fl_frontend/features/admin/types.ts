import type { FLSpielTeamField } from "../spiele/types";

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
