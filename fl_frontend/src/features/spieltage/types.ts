/**
 * SPIELTAGE · query parameter types and the admin list's assembled row
 *
 * Outbound query shapes, not validation — inbound data is validated by `schemas.ts`.
 *
 * `saison_phase` widens the stored enum with `"playoffs"`, which is a query-only alias meaning "any
 * phase except gruppenphase". It is valid to send and never valid to receive.
 */

import type { FLSaisonPhase } from "../saisons/schemas";
import type { FLPostSpieltagPayload } from "./schemas";

export type FLSpieltageSortingOptions = "beginn" | "ende" | "anzahl_spiele" | "order_val";

export type FLSpieltageFilterParams = {
  saison_id?: string;
  saison_phase?: "playoffs" | FLSaisonPhase;
  // Retired matchdays are excluded unless an admin surface asks for them (ADR-0032). The admin list
  // is the one caller that does: a retired matchday still holds matches, so hiding it there would
  // hide the reason those matches are where they are.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpieltageSortingOptions;
  order?: "asc" | "desc";
};

/**
 * The create form's draft — the payload with the picked field widened to `null`, so the form can
 * start with no phase chosen rather than silently preselecting one. The schema is what turns an
 * untouched picker into a field error rather than a type error.
 */
export type SpieltagCreateDraft = Omit<FLPostSpieltagPayload, "saison_phase"> & {
  saison_phase: FLSaisonPhase | null;
};

/**
 * One row of the admin matchday list.
 *
 * **`spieleAngelegt` is the whole reason this is a list rather than a link into the Spielplan.**
 * `anzahl_spiele` is a hand-maintained count of something countable — the backend writes it as given
 * and never derives it — so the only surface that can catch it drifting is one that shows the stored
 * number beside the fixtures actually attached to this matchday.
 *
 * `hasOrderCollision` is the other: nothing in the database or the API stops two matchdays of one
 * season holding the same `order_val`, and the bracket orders by that field.
 */
export type AdminSpieltagRow = {
  id: string;
  name: string;
  beginn: string;
  ende: string;
  anzahl_spiele: number;
  order_val: number;
  saison_phase: FLSaisonPhase;
  saison_id: string;
  inactive_since: string | null;
  /** How many matches actually carry this matchday's id, counted from the season's fixtures. */
  spieleAngelegt: number;
  /** True when another matchday of the same season holds this `order_val`. */
  hasOrderCollision: boolean;
};
