import type { FLPostSpielortPayload } from "./schemas";

/**
 * The shape the create/edit form edits.
 *
 * Derived from the payload schema the server action validates, rather than restated — the two were
 * a near-copy of each other and could drift apart silently.
 *
 * `default_mietpreis` widens to `number | null` for the reason given on `SchiedsrichterDraft`: an
 * emptied currency field must not become 0.
 */
export type SpielortDraft = Omit<FLPostSpielortPayload, "default_mietpreis"> & { default_mietpreis: number | null };

export type FLSpielorteSortingOptions = "name";

export type FLSpielorteFilterParams = {
  is_inactive?: boolean;

  limit?: number;
  sort_by?: FLSpielorteSortingOptions;
  order?: "asc" | "desc";
};
