/**
 * The reason's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py` and paired with it by
 * `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_BOUNDS`. Bound here too because the
 * endpoint refuses a length with a bare `REQ-VAL-001` and no field detail, so nothing marks the box.
 */
export const SPERRLISTE_GRUND_MAX_LENGTH = 500;

// Retyped from `fl_backend/app/shared/schemas/bounds.py` for the privacy notice and
// `SPERRE_DAUER_HINWEIS`, which state the ban's length in a word; the notice's render test holds
// both words to this number.
export const SPERRE_DAUER_SAISONS = 5;

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

/**
 * What a CLEAN save answers. `EntityForm` shows it beside the form's title only where the two
 * DIFFER, which is how a failed send is told apart. The form spells the same words as a literal,
 * which `core/toastTitles.test.ts` needs.
 */
export const SPERRE_ERFOLG = "Adresse gesperrt";

/** The eyebrow over the bound on a row, and the phrasing that makes the named season a barred one rather than the first free one. */
export const SPERRE_BIS_LABEL = "Gesperrt bis";

export const sperreBisWert = (saisonId: string): string => `einschließlich Saison ${saisonId}`;

/** Under the create form's own address box, because the lapse is what the person typed into it is being signed up for. */
export const SPERRE_DAUER_HINWEIS =
  "Die Sperre endet nach fünf vollen Saisons von selbst. Die Adresse erhält sofort eine E-Mail, die den Grund, die Dauer und das Widerspruchsrecht nennt.";
