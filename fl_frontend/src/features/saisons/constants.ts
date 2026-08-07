/**
 * SAISONS · search copy and the season id's shape
 *
 * Its own module, not an export from a view: those files are `"use client"`, and every export of a
 * client module becomes a client reference on the server side.
 *
 * The page's name and its explanation are NOT here — they are the navigation structure's, which the
 * shell's bar renders, so the title an admin reads is the nav item they clicked (ADR-0058).
 */

export const SAISONS_CRUD_COPY = {
  searchLabel: "Saison suchen",
  searchPlaceholder: "Suchen nach Saison-ID oder Zeitraum...",
} as const;

/**
 * Exactly four characters, and the create form carries the bound so the browser refuses a fifth
 * keystroke.
 *
 * `saisons._id` is the string every `saison_id` in the database references, and both `FLSpiel` and
 * `FLSpieltag` require exactly this length of whatever they point at — so a longer id validates as a
 * season and then breaks every match and matchday belonging to it. The SCHEMA is what produces the
 * message, because the action validates the payload and returns the field error the form renders.
 */
export const SAISON_ID_LENGTH = 4;
