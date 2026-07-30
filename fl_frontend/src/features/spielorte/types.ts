import type { FLPostSpielortPayload } from "./schemas";

/**
 * The shape the create/edit form edits.
 *
 * Derived from the payload schema the server action validates, rather than restated — the two were
 * a near-copy of each other and could drift apart silently.
 */
export type SpielortDraft = FLPostSpielortPayload;

export type FLSpielorteSortingOptions = "name";

export type FLSpielorteFilterParams = {
  is_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
};
