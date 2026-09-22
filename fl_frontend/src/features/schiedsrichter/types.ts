import type {
  FLPostSchiedsrichterPayload,
  FLSchiedsrichter,
  FLSchiedsrichterBestaetigungAnsichtResponse,
  FLSchiedsrichterPayloadDraft,
} from "./schemas";

/** Every state the referee's link can be in but open. „ungueltig“ is this side's, for a token the read refused. */
export type SchiedsrichterLinkZustand = "bestaetigt" | "abgelaufen" | "ungueltig";

/** A link still open, and so a row that still holds the person the page is about to name. */
export type SchiedsrichterAnsichtGeoeffnet = FLSchiedsrichterBestaetigungAnsichtResponse & { vorname: string };

export type SchiedsrichterAnsicht = { zustand: "gueltig"; ansicht: SchiedsrichterAnsichtGeoeffnet } | { zustand: SchiedsrichterLinkZustand };

// The three admin-only blocks are out: a fixture's held referee and a just-created one are each
// composed at the call site, where a required block would be written as a null claiming the referee
// has no link.
/**
 * A referee whose `name` is the word on screen rather than the stored one, so a control that must
 * show something takes an erased referee without a null reaching it. Built through
 * `fl_frontend/src/features/schiedsrichter/constants.ts :: bookedSchiedsrichterName`.
 */
export type FLSchiedsrichterAngezeigt = Pick<FLSchiedsrichter, "id" | "schule" | "kontakt" | "default_payment" | "inactive_since"> & {
  name: string;
};

/**
 * Derived from the payload schema the action validates, never restated; the widening at the fee is
 * `fl_frontend/src/features/schiedsrichter/schemas.ts :: FLSchiedsrichterPayloadDraft`'s.
 */
export type SchiedsrichterDraft = FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>;

type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export type FLSchiedsrichterFilterParams = {
  default_payment?: number;
  // A switch, not a value to match on: retirement is a date, and a caller wanting the retired
  // referees wants them beside the live ones.
  include_inactive?: boolean;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
};
