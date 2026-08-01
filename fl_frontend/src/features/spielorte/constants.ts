/**
 * Copy for the Spielorte admin page. Its own module for the same reason as
 * `schiedsrichter/constants.ts` — the page and the client view both read it.
 */
export const SPIELORTE_CRUD_COPY = {
  title: "Spielorte",
  description: "Verwalte alle Austragungsorte und deren Infrastruktur.",
  searchLabel: "Spielorte suchen",
  searchPlaceholder: "Suchen nach Name, Straße, PLZ, Stadtteil...",
} as const;
