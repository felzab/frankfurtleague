import type { FLGruppenNames } from "./schemas";

export const TEAMS_CRUD_COPY = {
  searchLabel: "Teams suchen",
  searchPlaceholder: "Suchen nach Name oder Kürzel...",
} as const;

/** In the order every picker offers them. The closed set is `FLGruppenNames`'s. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = ["A", "B", "C", "D"];

/** The description's length bound, mirrored from the backend model and enforced at the textarea. */
export const DESCRIPTION_MAX_LENGTH = 4096;
