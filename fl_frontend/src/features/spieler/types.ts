export type FLSpielerSortingOptions = "vorname" | "nachname" | "stufe" | "nummer" | "position";

export interface FLSpielerFilterParams {
  team_id?: string;
  saison_id?: string;
  is_nachgetragen?: boolean;
  stufe?: string;

  limit?: number;
  sort_by?: FLSpielerSortingOptions;
  order?: "asc" | "desc";
}
