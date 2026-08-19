import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLPatchSpieltagPayload, FLPostSpieltagPayload } from "./schemas";

// `natural` is the backend's derived order and the default: phase in bracket order, then `beginn`,
// then `_id`. `anzahl_spiele` is not sortable — derived on read, so no Mongo sort can reach it.
export type FLSpieltageSortingOptions = "natural" | "beginn" | "ende";

export type FLSpieltageFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;
  // The admin list is the one caller that asks: a retired matchday still holds matches, so hiding it
  // there would hide the reason those matches are where they are.
  include_inactive?: boolean;

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
  /** Composed from the phase and `ordinal`, never stored. See `spieltagLabels`. */
  label: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  saison_phase: FLSaisonPhase;
  saison_id: string;
  inactive_since: string | null;
  /** How many matches actually carry this matchday's id, counted from the season's fixtures. */
  spieleAngelegt: number;
  /**
   * The count `REQ-RETIRE-002` refuses a retirement over. The list uses it to not offer the control
   * rather than to explain a 409 afterwards.
   */
  spieleGespielt: number;
  /** 1-based place within this row's phase section. Derived per render, never stored. */
  ordinal: number;
};
