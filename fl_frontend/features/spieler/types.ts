export type FLSpielerSortingOptions = "vorname" | "nachname" | "stufe" | "nummer" | "position";

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

export interface FLSpielerFilterParams {
  team_id?: string;
  saison_id?: string;
  is_nachgetragen?: boolean;
  stufe?: string;

  limit?: number;
  sort_by?: FLSpielerSortingOptions;
  order?: "asc" | "desc";
}

export interface FLSpielerListResponse {
  spieler: FLSpieler[];
}
