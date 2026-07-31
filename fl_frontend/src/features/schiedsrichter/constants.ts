/**
 * Copy for the Schiedsrichter admin page.
 *
 * Its own module, not an export from `AdminSchiedsrichterView`: that file is `"use client"`, and
 * every export of a client module becomes a client reference on the server side. The page renders
 * the heading (via `AdminCrudShell`) and the view renders the search field, so both need these
 * strings — a shared server-safe module is what keeps them from drifting apart.
 */
export const SCHIEDSRICHTER_CRUD_COPY = {
  title: "Schiedsrichter",
  description: "Verwalte alle Schiedsrichter, deren Kontaktdaten und Honorare.",
  searchLabel: "Schiedsrichter suchen",
  searchPlaceholder: "Suchen nach Name, Schule, E-Mail...",
} as const;
