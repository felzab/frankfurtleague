import type { FLPostSchiedsrichterPayload, FLSchiedsrichterPayloadDraft } from "./schemas";

/**
 * Derived from the payload schema the action validates, never restated; the widening at the fee is
 * `fl_frontend/src/features/schiedsrichter/schemas.ts :: FLSchiedsrichterPayloadDraft`'s.
 */
export type SchiedsrichterDraft = FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>;

type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export type FLSchiedsrichterFilterParams = {
  default_payment?: number;
  // A switch, not a value to match on: retirement is a date, and a caller wanting the retired
  // referees wants them beside the live ones — the admin list, which is where one is reactivated.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
};
