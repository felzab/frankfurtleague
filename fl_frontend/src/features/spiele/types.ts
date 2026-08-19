/**
 * SPIELE · query parameter types, and the classification a Spiel can need attention under
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * Two values here mean something different from what they mean on a document: `saison_phase` accepts
 * `"playoffs"`, a query-only alias for "not gruppenphase", and `spiel_status` is a filter the backend
 * compiles to a date comparison rather than a stored field.
 */

import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLSpielStatus } from "./schemas";

/**
 * The eight things that can make a match need admin attention.
 *
 * **Declared here rather than in `admin`, because it classifies a Spiel.** `admin` owns the view that
 * groups by it — `categorizeActionRequired` and the German labels stay there — but two surfaces read
 * the classification now: that list, and the edit page, which marks a field the category says somebody
 * is waiting on (`draftStatus.ts`). A type in `admin` would have made `spiele` depend on the
 * aggregator, which is the dependency the Spiel write path stays out of `admin` to avoid.
 *
 * A literal union rather than a loose index signature: the categorisation builds a fully keyed
 * accumulator, so every read is checked and a mistyped category is a compile error instead of a
 * runtime crash on `undefined.spiele`.
 */
export type ActionRequiredCategory =
  | "ergebnis_pending"
  | "besetzung_missing"
  | "bracket_fault"
  | "datum_missing"
  | "uhrzeit_missing"
  | "ort_missing"
  | "schiedsrichter_missing"
  | "is_canceled";

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
