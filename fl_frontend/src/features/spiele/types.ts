/**
 * SPIELE · query parameter types
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Two values here mean something different from what they mean on a document: `saison_phase` accepts
 * `"playoffs"`, a query-only alias for "not gruppenphase", and `spiel_status` is a filter the backend
 * compiles to a date comparison rather than a stored field.
 */

import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLSpielStatus } from "./schemas";

export type FLSpieleSortingOptions = "datum" | "uhrzeit" | "spiel_nr" | "saison_phase";

export type FLSpieleFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;
  spiel_status?: FLSpielStatus;
  team_id?: string;

  limit?: number;
  sort_by?: FLSpieleSortingOptions;
  order?: "asc" | "desc";
};
