export type FLSaisonsSortOptions = "_id" | "start_date" | "end_date";

export type FLSaisonsFilterParams = {
  saison_id?: string;
  status?: string;

  limit?: number;
  sort_by?: FLSaisonsSortOptions;
  order?: "asc" | "desc";
};
