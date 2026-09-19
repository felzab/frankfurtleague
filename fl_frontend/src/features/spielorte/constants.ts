// Its own module: every export of a `"use client"` view becomes a client reference.
export const SPIELORTE_CRUD_COPY = {
  searchLabel: "Spielorte suchen",
  searchPlaceholder: "z.B. Sportpark Nord oder Nordend",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Neuen Spielort anlegen",
} as const;
