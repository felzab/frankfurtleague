/**
 * The most outbox rows one stamp names, mirroring the backend's `LIST_LIMIT_DEFAULT`
 * (`fl_backend/app/shared/schemas/bounds.py`), which also caps what one claim hands out.
 */
export const ANKUENDIGUNGEN_MAX = 1024;

// Its own module: every export of a `"use client"` view becomes a client reference.
export const BERECHTIGUNGEN_CRUD_COPY = {
  // The address and who granted it are what a row carries, so they are what the bar can reach.
  searchLabel: "Zugänge suchen",
  searchPlaceholder: "z.B. name@beispiel.de",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Zugang erteilen",
  // Two rather than three: the page declares no facet, so `filtered` is reachable by no press.
  emptyForQuery: "Kein Zugang für diese Suche.",
  emptyOverall: "Es hat noch niemand Zugang zur Verwaltung.",
} as const;

/** The badge on an `owner` grant, which no control on this page changes. */
export const INHABER_LABEL = "Inhaber";

/** A barred address is served withheld, so the row names the state rather than an address it does not have. */
export const GESPERRTE_ADRESSE = "Gesperrte Adresse";

/** The eyebrows over a row's two facts. */
export const ERTEILT_VON_LABEL = "Erteilt von";
export const ERTEILT_AM_LABEL = "Erteilt am";

/** What a CLEAN grant answers, beside the form's title only where the two differ. */
export const ZUGANG_ERTEILT = "Zugang erteilt";

/** What the revoke costs, in its armed state: the person is out at once, and everybody is told. */
export const ZUGANG_ENTZIEHEN_CONSEQUENCE =
  "Die Adresse kann die Verwaltung ab sofort nicht mehr betreten. Alle mit Zugang erhalten eine E-Mail.";

/** What a clean revoke answers, the approved notice's own sentence with the address left out. */
export const ZUGANG_ENTZOGEN_MESSAGE = "Diese Adresse hat keinen Zugang zur Verwaltung mehr.";

/** Rows the backend left out as no request can match them: a database paste to repair, never one this page can make. */
export const uebersprungenHinweis = (anzahl: number): string =>
  anzahl === 1
    ? "Ein Eintrag in der Datenbank passt zu keiner Adresse und gewährt keinen Zugang."
    : `${String(anzahl)} Einträge in der Datenbank passen zu keiner Adresse und gewähren keinen Zugang.`;
