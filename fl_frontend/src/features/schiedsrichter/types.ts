export type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export interface FLSchiedsrichterFilterParams {
  default_payment?: number;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
}
