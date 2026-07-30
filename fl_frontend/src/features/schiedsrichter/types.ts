import type { FLPostSchiedsrichterPayload } from "./schemas";

/**
 * The shape the create/edit form edits.
 *
 * Derived from the payload schema the server action validates, rather than restated — the two were
 * a near-copy of each other and could drift apart silently.
 */
export type SchiedsrichterDraft = FLPostSchiedsrichterPayload;

export type FLSchiedsrichterSortingOptions = "name" | "default_payment";

export type FLSchiedsrichterFilterParams = {
  default_payment?: number;
  // Declared by the backend's FLSchiedsrichterFilterParams (bool | None = False). No caller passes
  // it yet -- getSchiedsrichter is only ever called with no arguments -- so soft-deleted referees
  // are currently unreachable from the frontend.
  is_inactive?: boolean;

  limit?: number;
  sort_by?: FLSchiedsrichterSortingOptions;
  order?: "asc" | "desc";
};
