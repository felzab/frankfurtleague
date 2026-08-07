/**
 * SPIELTAGE · search copy
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of a
 * client module becomes a client reference on the server side.
 *
 * **Neither the phase labels nor the phase order live here.** Both are in
 * `fl_frontend/src/features/saisons/constants.ts`, beside the `FLSaisonPhase` enum they describe —
 * `spiele`, `spieltage` and the season editor all read them, so a copy in any one slice would be a
 * second answer to a question the set itself owns.
 */

export const SPIELTAGE_CRUD_COPY = {
  searchLabel: "Spieltag suchen",
  searchPlaceholder: "Suchen nach Spieltag, Runde oder Datum...",
} as const;
