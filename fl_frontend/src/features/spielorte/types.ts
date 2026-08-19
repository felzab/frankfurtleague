/**
 * SPIELORTE · view and form types
 *
 * The types the slice's components speak, as distinct from the wire schemas in `schemas.ts`. The
 * form draft is *derived* from the payload schema rather than restated, so the two cannot drift.
 */

import type { FLPostSpielortPayload } from "./schemas";

/**
 * The shape the create/edit form edits.
 *
 * Derived from the payload schema the server action validates, rather than restated — the two were
 * a near-copy of each other and could drift apart silently.
 *
 * `default_mietpreis` stays a plain number — see the note on `SchiedsrichterDraft`.
 */
export type SpielortDraft = FLPostSpielortPayload;

export type FLSpielorteSortingOptions = "name";

export type FLSpielorteFilterParams = {
  // A switch, not a value to match on: retirement is a date (ADR-0025), and a caller wanting the retired
  // venues wants them alongside the live ones — the admin list, which is where one is reactivated. The
  // match editor's picker leaves it off.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
};
