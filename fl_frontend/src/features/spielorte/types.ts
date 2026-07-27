export type FLSpielorteSortingOptions = "name";

export interface FLSpielorteFilterParams {
  is_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
}
