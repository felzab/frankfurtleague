import type { FLKontakt } from "@/shared/types/sharedTypes";

export type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export interface FLSchiedsrichter {
  id: string;
  name: string;
  schule: string | null;
  default_payment: number;
  kontakt: FLKontakt;
}

export interface FLSchiedsrichterFilterParams {
  default_payment?: number;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
}

export interface FLSchiedsrichterListResponse {
  schiedsrichter: FLSchiedsrichter[];
}
