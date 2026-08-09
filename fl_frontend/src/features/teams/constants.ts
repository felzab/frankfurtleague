/**
 * TEAMS · admin page copy and group options
 *
 * Its own module, not an export from `AdminTeamsView`: that file is `"use client"`, and every
 * export of a client module becomes a client reference on the server side.
 *
 * The page's name and explanation are the navigation structure's, which the shell's bar renders —
 * the title an admin reads is the nav item they clicked.
 */

import type { FLGruppenNames } from "./schemas";

export const TEAMS_CRUD_COPY = {
  searchLabel: "Teams suchen",
  searchPlaceholder: "Suchen nach Name oder Kürzel...",
} as const;

/** The four groups, in the order every picker offers them. The closed set is `FLGruppenNames`'s. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = ["A", "B", "C", "D"];

/** The description's length bound, mirrored from the backend model and enforced at the textarea. */
export const DESCRIPTION_MAX_LENGTH = 4096;
