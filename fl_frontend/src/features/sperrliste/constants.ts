import { buildRefusal } from "@/shared/utils/refusal";

/**
 * The reason's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py` and paired with it by
 * `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_BOUNDS`. Bound here too because the
 * endpoint's `REQ-VAL-001` marks an over-long box with a generic sentence rather than the bound's German.
 */
export const SPERRLISTE_GRUND_MAX_LENGTH = 500;

/**
 * Retyped from `fl_backend/app/shared/schemas/bounds.py` for the privacy notice, `SPERRE_DAUER_HINWEIS`
 * and the ban list's sidemenu note, which state the ban's length in a word. The notice's render test
 * holds all three words to this number.
 * @internal
 */
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

  // Three sentences where every sibling list has one: „nichts gefunden“ reads here as „nicht
  // gesperrt“, and the reader cannot see that the bar never had an address to match.
  emptyForQuery:
    "Keine Sperren für diese Suche. Die Suche liest den Grund und wer die Sperre eingetragen hat. Die gesperrte Adresse steht in keiner Zeile.",
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
 * DIFFER, which is how a failed send is told apart.
 */
export const SPERRE_ERFOLG = "Adresse gesperrt";

/**
 * The create dialog's second state: a ban cascades to no record, so what the address still holds is shown at the one
 * moment anybody holds the address, each record linked to the tool that acts on it.
 */
export const SPERRE_ANSICHT_COPY = {
  heading: "Was unter dieser Adresse noch gespeichert ist",
  lead: "Die Sperre wirkt sofort. Diese Einträge bleiben bestehen, bis Du sie bearbeitest.",
  // Its team can only decline it, the admission refusing a barred address, and the clock erases it either way.
  registrierungen: "Eine Registrierung endet von selbst, denn ihr Team kann sie nicht mehr aufnehmen.",
  // A record, never „nichts“: the account and the log below stand whatever the read found, as the erasure's reveal says.
  leer: "Unter dieser Adresse ist kein Eintrag gespeichert.",
  // The account sweep's criterion in the ban mail's kinds, a grant left out: no barred address holds one
  // (`REQ-SPERRLISTE-003`). The sweep, and never the ban, ends it.
  konto:
    "Ein Konto mit dieser Adresse bleibt nur bestehen, solange unter der Adresse noch etwas davon gespeichert ist: ein Platz als Kontaktperson eines Teams in einer Saison oder in einer Bewerbung, über die noch nicht entschieden ist, ein Eintrag als Spielerin, Spieler, Schiedsrichterin oder Schiedsrichter oder eine bestätigte Registrierung, über die das Team noch nicht entschieden hat. Bis die Sperre endet, kann sich damit niemand anmelden.",
  // What no record read lists and the ban changes nothing of, named as the erasure's reveal names it.
  protokoll:
    "Wo die Adresse im Änderungsprotokoll oder als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen steht, bleibt sie stehen.",
  nichtGeladen: "Was unter der Adresse gespeichert ist, konnte nicht geladen werden. Die Sperre steht.",
  fertig: "Fertig",
} as const;

/** Each record's link, named for what the page it opens does to that record. */
export const SPERRE_ANSICHT_VERWEISE = {
  kontakte: "Kontakte bearbeiten",
  kader: "Kadereintrag austragen",
  // A record left with nothing to take out, whose record is what stands: a pupil holding no squad row, a squad row
  // taken out, a referee retired.
  eintrag: "Eintrag ansehen",
  stilllegen: "Schiedsrichter stilllegen",
  bewerbung: "Bewerbung öffnen",
  registrierungen: "Registrierungen ansehen",
  adresswechsel: "Adressänderung ansehen",
} as const;

/**
 * A referee's fixtures link, one per season holding a booking still to be played, ahead of the retirement:
 * `REQ-RETIRE-004` refuses it while any stands.
 */
export const spieleNeuBesetzen = (saisonId: string): string => `Spiele der Saison ${saisonId} neu besetzen`;

/** The eyebrow over the bound on a row, and the phrasing that makes the named season a barred one rather than the first free one. */
export const SPERRE_BIS_LABEL = "Gesperrt bis";

export const sperreBisWert = (saisonId: string): string => `einschließlich Saison ${saisonId}`;

/** Under the create form's own address box, because the lapse is what the person typed into it is being signed up for. */
export const SPERRE_DAUER_HINWEIS =
  "Die Sperre endet nach fünf vollen Saisons von selbst. Laufende Anmeldungen der Adresse werden sofort beendet. Hat die Adresse ein Konto, erhält sie eine E-Mail, die den Grund, die Dauer und das Widerspruchsrecht nennt.";

/**
 * The administrator's own sentence rather than a visitor's neutral one: every site raising it is
 * admin-tier, and hiding the ban from the person who keeps the list hides it from the one reader who
 * can act on it.
 */
export const SPERRLISTE_ADRESSE_GESPERRT = buildRefusal({
  reason: "Diese E-Mail-Adresse steht auf der Sperrliste",
  repair: "Trage eine andere Adresse ein oder hebe die Sperre unter /bereich/admin/sperrliste auf",
});
