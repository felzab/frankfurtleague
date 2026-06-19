import type { FLSpielOrtField, FLSpielSchiedsrichterField, FLSpielTeamField } from "../spiele/types";

export interface PatchAdminSpielDataPayload {
  datum: string;
  uhrzeit: string;
  ort: FLSpielOrtField;
  schiedsrichter: FLSpielSchiedsrichterField;
  team1: FLSpielTeamField;
  team2: FLSpielTeamField;
  spiel_id: string;
  is_canceled: boolean;
}
