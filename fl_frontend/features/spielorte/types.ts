import type { FLAddress } from "@/shared/types/sharedTypes";

export type FLSpielorteSortingOptions = "name";

export interface FLSpielort {
  id: string;
  address: FLAddress;
  name: string;
  maps_link: string;
  default_mietpreis: number;
}

export interface FLSpielorteFilterParams {
  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
}

export interface FLSpielorteListResponse {
  spielorte: FLSpielort[];
}
