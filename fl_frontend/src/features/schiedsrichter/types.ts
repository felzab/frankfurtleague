import type { FLPostSchiedsrichterPayload, FLSchiedsrichterPayloadDraft } from "./schemas";

/**
 * Derived from the payload schema the action validates, never restated, and widened at the fee: an untouched or
 * emptied box holds `null`, which the schema refuses by name. Spreading a narrower `T` here would type the write
 * as `T & { default_payment: number | null }` — assignable to `T`, so the `null` vanishes from the caller's view.
 */
export type SchiedsrichterDraft = FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>;

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
