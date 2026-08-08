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

// `natural` is the derived order the backend applies and the default: the phase in bracket order, then
// `beginn`, then `name` (ADR-0064). No caller passes either of the others, and none should have to.
// `anzahl_spiele` is not sortable, because it is derived on read rather than stored, so no Mongo sort
// can reach it (ADR-0065).
export type FLSpieltageSortingOptions = "natural" | "beginn" | "ende";

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
 *
 * The phase is also what decides where the new matchday lands in the list, since the order is derived
 * from it (ADR-0064) — so the one field the form must not guess is the one that positions the row.
 */
export type SpieltagCreateDraft = Omit<FLPostSpieltagPayload, "saison_phase"> & {
  saison_phase: FLSaisonPhase | null;
};

/**
 * One row of the admin matchday list.
 *
 * **`spieleAngelegt` is the whole reason this is a list rather than a link into the Spielplan.**
 * `anzahl_spiele` is how many matches this matchday *should* hold, derived from the season's rules
 * (ADR-0065); `spieleAngelegt` is how many actually carry its id. Both are facts about the same
 * matchday and nothing holds them equal, because a season being set up passes through every
 * intermediate count — so a surface showing the two side by side is the only place the difference is
 * visible.
 *
 * **`ordinal` is presentation and nothing else.** It is the row's 1-based place within its phase
 * section, assigned by the page from the order the API already returned (ADR-0064). Nothing stores it,
 * no payload carries it, and two rows cannot claim the same one — so unlike the position it replaced,
 * there is no state for it to be wrong about.
 */
export type AdminSpieltagRow = {
  id: string;
  /** Composed from the phase and `ordinal`, never stored (ADR-0067). See `spieltagLabels`. */
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
   * How many of those carry a result — the count `REQ-RETIRE-002` refuses a retirement over.
   *
   * Retiring a matchday takes its fixtures off the public Spielplan with it, so a played result would be
   * unpublished. The list uses this to not offer the control rather than to explain a 409 afterwards.
   */
  spieleGespielt: number;
  /** 1-based place within this row's phase section. Derived per render, never stored. */
  ordinal: number;
};
