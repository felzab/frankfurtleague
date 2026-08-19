import type { FLPostSpielortPayload } from "./schemas";

/**
 * Derived from the payload schema the action validates, never restated. `default_mietpreis` stays a
 * plain number for `SchiedsrichterDraft`'s reason: 0 € is a legitimate default.
 */
export type SpielortDraft = FLPostSpielortPayload;

export type FLSpielorteSortingOptions = "name";

export type FLSpielorteFilterParams = {
  // A switch, not a value to match on: retirement is a date, and a caller wanting the retired venues
  // wants them beside the live ones — the admin list, which is where one is reactivated.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
};
