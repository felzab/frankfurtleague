// Its own module and not an export of the `"use client"` view: every export of a client module
// becomes a client reference on the server side.
export const SCHIEDSRICHTER_CRUD_COPY = {
  searchLabel: "Schiedsrichter suchen",
  searchPlaceholder: "Suchen nach Name, Schule, E-Mail oder Telefon...",
} as const;
