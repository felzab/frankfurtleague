import type { FLPostSchiedsrichterPayload, FLSchiedsrichter, FLSchiedsrichterPayloadDraft } from "./schemas";

/**
 * A referee whose `name` is the word on screen rather than the stored one, so a control that must
 * show something takes an erased referee without a null reaching it. Built through
 * `fl_frontend/src/features/schiedsrichter/constants.ts :: schiedsrichterAnzeigename`.
 */
export type FLSchiedsrichterAngezeigt = FLSchiedsrichter & { name: string };

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
  // The erasure's own switch, separate from the retirement's: an erased referee is retired too, so
  // one flag over both would offer them wherever a retired referee is offered.
  include_anonymisiert?: boolean;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
};
