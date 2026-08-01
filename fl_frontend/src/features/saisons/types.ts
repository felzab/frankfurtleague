/**
 * SAISONS · query parameter types
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Note `sort_by: "_id"` sorts by the season id, which is the four-character year string, so it sorts
 * chronologically. That is a property of the id format, not a coincidence.
 */

export type FLSaisonsSortOptions = "_id" | "start_date" | "end_date";

export type FLSaisonsFilterParams = {
  saison_id?: string;
  status?: string;

  limit?: number;
  sort_by?: FLSaisonsSortOptions;
  order?: "asc" | "desc";
};
