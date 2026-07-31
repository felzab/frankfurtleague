import type { FLPostSchiedsrichterPayload } from "./schemas";

/**
 * The shape the create/edit form edits.
 *
 * Derived from the payload schema the server action validates, rather than restated — the two were
 * a near-copy of each other and could drift apart silently.
 *
 * `default_payment` widens to `number | null`, and only here: an emptied currency field is empty,
 * not zero. Coercing it back to 0 at the input is what let a cleared Honorar submit as 0 € in
 * silence (ledger R4-3.1). The payload schema still requires a number, so clearing it fails
 * validation with a message on the field instead.
 */
export type SchiedsrichterDraft = Omit<FLPostSchiedsrichterPayload, "default_payment"> & { default_payment: number | null };

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
