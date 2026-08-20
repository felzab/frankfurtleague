import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLPatchSpieltagPayload, FLPostSpieltagPayload } from "./schemas";

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

/**
 * The payload with the picked field widened to `null`, so the form starts with no phase chosen and the
 * schema turns an untouched picker into a field error rather than a type error.
 */
export type SpieltagCreateDraft = Omit<FLPostSpieltagPayload, "saison_phase"> & {
  saison_phase: FLSaisonPhase | null;
};

/**
 * Widened the same way, though a stored matchday always HAS a phase: one shape across the draft, the
 * schema that judges it and the payload the action parses, so the editor never casts on the way out.
 */
export type SpieltagEditDraft = Omit<FLPatchSpieltagPayload, "saison_phase"> & {
  saison_phase: FLSaisonPhase | null;
};

/**
 * **`spieleAngelegt` against `anzahl_spiele` is why this is a list and not a link into the
 * Spielplan**: nothing holds the two equal, because a season being set up passes through every count.
 */
export type AdminSpieltagRow = {
  id: string;
  /** Composed from the phase and `position`, never stored. See `spieltagLabels`. */
  label: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  saison_phase: FLSaisonPhase;
  saison_id: string;
  /** How many matches actually carry this matchday's id, counted from the season's fixtures. */
  spieleAngelegt: number;
  /** The served place within this row's phase, which the label renders and the editor writes. */
  position: number;
};
