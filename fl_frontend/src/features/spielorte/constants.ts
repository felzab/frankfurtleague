// Its own module and not an export of the `"use client"` view: every export of a client module
// becomes a client reference on the server side.
export const SPIELORTE_CRUD_COPY = {
  searchLabel: "Spielorte suchen",
  searchPlaceholder: "Suchen nach Name, Straße, PLZ, Stadtteil...",
} as const;
