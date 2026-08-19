import type { FLPostSchiedsrichterPayload } from "./schemas";

/**
 * Derived from the payload schema the action validates, never restated. `default_payment` stays a
 * plain number: 0 € is a legitimate default, and the "emptied field must not become 0" rule is the
 * match-level override's in `spiele/schemas.ts`.
 */
export type SchiedsrichterDraft = FLPostSchiedsrichterPayload;

export type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export type FLSchiedsrichterFilterParams = {
  default_payment?: number;
  // A switch, not a value to match on: retirement is a date, and a caller wanting the retired
  // referees wants them beside the live ones — the admin list, which is where one is reactivated.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
};
