/**
 * SCHIEDSRICHTER · view and form types
 *
 * The types the slice's components speak, as distinct from the wire schemas in `schemas.ts`. The
 * form draft is *derived* from the payload schema rather than restated, so the two cannot drift.
 */

import type { FLPostSchiedsrichterPayload } from "./schemas";

/**
 * The shape the create/edit form edits.
 *
 * Derived from the payload schema the server action validates, rather than restated — the two were
 * a near-copy of each other and could drift apart silently.
 *
 * `default_payment` stays a plain number. 0 € is a legitimate standard honorar (a volunteer), the
 * field is `isRequired`, and the "emptied field must not become 0" rule applies to the MATCH-level
 * override in `spiele/schemas.ts` — not to an entity default.
 */
export type SchiedsrichterDraft = FLPostSchiedsrichterPayload;

export type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export type FLSchiedsrichterFilterParams = {
  default_payment?: number;
  // A switch, not a value to match on: retirement is a date (ADR-0025), and a caller wanting the retired
  // referees wants them alongside the live ones — the admin list, which is where one is reactivated. The
  // match editor's picker leaves it off.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
};
