import type { FLPostSpielortPayload, FLSpielortPayloadDraft } from "./schemas";

/**
 * Derived from the payload schema the action validates, never restated, and widened at the rent for
 * `SchiedsrichterDraft`'s reason: an untouched or emptied box holds `null`, which the schema refuses by name.
 */
export type SpielortDraft = FLSpielortPayloadDraft<FLPostSpielortPayload>;

export type FLSpielorteSortingOptions = "name";

export type FLSpielorteFilterParams = {
  // A switch, not a value to match on: retirement is a date, and a caller wanting the retired venues
  // wants them beside the live ones — the admin list, which is where one is reactivated.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
};
