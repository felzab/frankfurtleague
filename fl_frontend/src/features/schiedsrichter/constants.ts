/**
 * Search copy for the Schiedsrichter admin page.
 *
 * Its own module, not an export from `AdminSchiedsrichterView`: that file is `"use client"`, and every
 * export of a client module becomes a client reference on the server side.
 *
 * The page's name and its explanation are NOT here — they are the navigation structure's, which the
 * shell's bar renders, so the title an admin reads is the nav item they clicked.
 */
export const SCHIEDSRICHTER_CRUD_COPY = {
  searchLabel: "Schiedsrichter suchen",
  searchPlaceholder: "Suchen nach Name, Schule, E-Mail...",
} as const;
