// Its own module: every export of a `"use client"` view becomes a client reference.
export const SPIELORTE_CRUD_COPY = {
  searchLabel: "Spielorte suchen",
  searchPlaceholder: "z.B. Sportpark Nord oder Nordend",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Neuen Spielort anlegen",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Spielorte für diese Suche.",
  emptyForFilters: "Keine Spielorte für diese Filter.",
  emptyOverall: "Es wurden noch keine Spielorte angelegt.",
} as const;

/**
 * What retiring a venue leaves standing, in the retirement dialog. Here rather than at the dialog, so
 * the sentence a reader is asked to act on sits beside the venue's other copy and is read once.
 */
export const SPIELORT_RETIREMENT_CONSEQUENCE = "Schon eingetragene Spiele behalten diesen Ort. Er steht künftig nur nicht mehr zur Auswahl.";
