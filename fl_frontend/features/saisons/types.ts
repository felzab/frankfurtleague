export type FLSaisonStatus = "past" | "active" | "future";
export type FLSaisonPhase = "gruppenphase" | "viertelfinale" | "halbfinale" | "finale";
export type FLSaisonsSortOptions = "_id" | "start_date" | "end_date";

export interface FLSaisonRules {
  win_points: number;
  draw_points: number;
}

export interface FLSaison {
  id: string;

  start_date: string;
  end_date: string;
  status: FLSaisonStatus;
  rules: FLSaisonRules;
}

export interface FLSaisonsFilterParams {
  saison_id?: string;
  status?: string;

  limit?: number;
  sort_by?: FLSaisonsSortOptions;
  order?: "asc" | "desc";
}

export interface FLSaisonsListResponse {
  format: "list";
  saisons: FLSaison[];
}

export interface FLSaisonsSingleResponse {
  format: "single";
  saison: FLSaison;
}
