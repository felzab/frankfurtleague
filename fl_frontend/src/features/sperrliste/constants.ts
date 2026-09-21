/**
 * The reason's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py` and paired with it by
 * `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_BOUNDS`. Bound here too because the
 * endpoint refuses a length with a bare `REQ-VAL-001` and no field detail, so nothing marks the box.
 */
export const SPERRLISTE_GRUND_MAX_LENGTH = 500;

// Its own module: every export of a `"use client"` view becomes a client reference.
export const SPERRLISTE_CRUD_COPY = {
  // The reason and the administrator are what a row carries, so they are what the bar can reach: the
  // address is a keyed hash and no query will ever match one.
  searchLabel: "Sperren suchen",
  searchPlaceholder: "z.B. falsches Geburtsdatum",
  /** The create trigger's words, which the route's loading placeholder also lays out, so its box is the trigger's own. */
  createLabel: "Adresse sperren",
  // Two rather than three: the page declares no facet and passes no route narrowing, so
  // `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: classifyEmptiness` can reach
  // `filtered` on no press a reader can make.

  // Two sentences where every sibling list has one: „nichts gefunden“ reads here as „nicht
  // gesperrt“, and the reader cannot see that the bar never had an address to match.
  emptyForQuery:
    "Keine Sperren für diese Suche. Die Suche liest den Grund und wer die Sperre eingetragen hat; die gesperrte Adresse steht in keiner Zeile.",
  emptyOverall: "Es ist noch keine Adresse gesperrt.",
} as const;

/**
 * What the removal costs, in its armed state. Every other row in the admin is retired and comes back
 * on one press, so a reader carrying that expectation here would lose a ban they cannot restore.
 */
export const SPERRE_AUFHEBEN_CONSEQUENCE =
  "Die Sperre verschwindet aus der Liste. Um die Adresse wieder zu sperren, musst Du sie neu eintragen.";
