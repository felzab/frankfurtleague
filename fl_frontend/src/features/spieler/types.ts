/**
 * SPIELER · query parameter types
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Unlike the other slices, an absent `saison_id` here does NOT resolve to the current season: this
 * endpoint is narrowed by `team_id` instead.
 */

export type FLSpielerSortingOptions = "vorname" | "nachname" | "stufe" | "nummer" | "position";

export type FLSpielerFilterParams = {
  team_id?: string;
  saison_id?: string;
  is_nachgetragen?: boolean;
  stufe?: string;

  limit?: number;
  sort_by?: FLSpielerSortingOptions;
  order?: "asc" | "desc";
};
