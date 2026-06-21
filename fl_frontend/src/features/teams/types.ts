export type FLTeamsSortingOptions = "name";

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
