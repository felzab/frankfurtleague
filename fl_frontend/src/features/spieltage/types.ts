import type { FLSaisonPhase } from "../saisons/schemas";

// `natural` is the backend's played order and the default: phase in bracket order, then the stored
// `position`. `anzahl_spiele` is not sortable — derived on read, so no Mongo sort can reach it.
export type FLSpieltageSortingOptions = "natural" | "beginn" | "ende";

export type FLSpieltageFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;

  limit?: number;
  sort_by?: FLSpieltageSortingOptions;
  order?: "asc" | "desc";
};

export type AdminSpieltagRow = {
  id: string;
  /** Composed from the phase and `position`, never stored. See `spieltagLabels`. */
  label: string;
  /** Null until somebody dates the matchday, which is the state every generated one starts in. */
  beginn: string | null;
  ende: string | null;
  anzahl_spiele: number;
  saison_phase: FLSaisonPhase;
  saison_id: string;
  /** The served place within this row's phase, which the label renders and the list numbers. */
  position: number;
};

/**
 * The list's row plus the one field only a fixture read answers. Separate, so the list page — which
 * fetches no fixtures — cannot stand a placeholder in for a count it does not have.
 */
export type AdminSpieltagEditRow = AdminSpieltagRow & {
  /** How many matches actually carry this matchday's id, counted from the season's fixtures. */
  spieleAngelegt: number;
};
