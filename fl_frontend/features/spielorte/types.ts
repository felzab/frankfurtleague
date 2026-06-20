export type FLSpielorteSortingOptions = "name";

export interface FLSpielorteFilterParams {
  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
}
