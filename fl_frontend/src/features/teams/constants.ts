/**
 * Search copy and the group options for the Teams admin page.
 *
 * Its own module, not an export from `AdminTeamsView`: that file is `"use client"`, and every export
 * of a client module becomes a client reference on the server side.
 *
 * The page's name and its explanation are NOT here — they are the navigation structure's, which the
 * shell's bar renders, so the title an admin reads is the nav item they clicked.
 */

import type { FLGruppenNames } from "./schemas";

export const TEAMS_CRUD_COPY = {
  searchLabel: "Teams suchen",
  searchPlaceholder: "Suchen nach Name oder Kürzel...",
} as const;

/** The four groups, in the order every picker offers them. The closed set is `FLGruppenNames`'s. */
export const GRUPPEN_OPTIONS: readonly FLGruppenNames[] = ["A", "B", "C", "D"];
