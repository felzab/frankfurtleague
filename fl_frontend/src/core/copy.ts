import { formatDatum, formatDatumLang, formatZahl } from "./format";

import type { Kalendertag } from "./format";

declare const copyMarke: unique symbol;

/**
 * A string the catalogue wrote. Every kit text prop takes this type, so a string typed into a page
 * does not compile; `as Copy` outside this file is the one way round it.
 */
export type Copy = string & { readonly [copyMarke]: true };

type Katalog<T> = T extends string
  ? Copy
  : T extends (...args: infer A) => string
    ? (...args: A) => Copy
    : { readonly [K in keyof T]: Katalog<T[K]> };

// The only assertion to `Copy`: the whole tree is branded at once, so no entry can be left plain.
const katalog = <const T>(baum: T): Katalog<T> => baum as Katalog<T>;

// Each label is the verb's infinitive capitalised, so `mitObjekt` lower-cases its first letter alone.
const VERB = {
  anlegen: "Anlegen",
  speichern: "Speichern",
  loeschen: "Löschen",
  entfernen: "Entfernen",
  zurueckziehen: "Zurückziehen",
  austragen: "Austragen",
  senden: "Senden",
  abschicken: "Abschicken",
  bestaetigen: "Bestätigen",
  ablehnen: "Ablehnen",
  widersprechen: "Widersprechen",
  uebernehmen: "Übernehmen",
  verwerfen: "Verwerfen",
  aufstellen: "Aufstellen",
  anmelden: "Anmelden",
  abmelden: "Abmelden",
} as const;

/** The closed set of button verbs: a button names its act with one of these. */
export type Verb = keyof typeof VERB;

const infinitiv = (verb: Verb): string => `${VERB[verb].charAt(0).toLowerCase()}${VERB[verb].slice(1)}`;

const UNERWARTET = "Etwas ist schiefgelaufen. Versuch es erneut.";

export const COPY = katalog({
  /** What every area draws from; an area adds a key of its own only for a string this lacks. */
  shared: {
    verb: VERB,
    /** „Team anlegen“: a button whose verb needs its object. */
    mitObjekt: (objekt: Copy, verb: Verb) => `${objekt} ${infinitiv(verb)}`,

    /** A field's one message line: what is expected, never the field's name. */
    feld: {
      pflichtfeld: "Pflichtfeld",
      hoechstensZeichen: (anzahl: number) => `Höchstens ${formatZahl(anzahl)} Zeichen`,
      mindestensZeichen: (anzahl: number) => `Mindestens ${formatZahl(anzahl)} Zeichen`,
      format: (beispiel: Copy) => `Format: ${beispiel}`,
      // A reserved domain, so no reader takes the example for the address the league expects.
      beispielAdresse: "name@example.com",
      zwischen: (von: number, bis: number) => `Zwischen ${formatZahl(von)} und ${formatZahl(bis)}`,
      fruehestens: (tag: Kalendertag) => `Frühestens ${formatDatum(tag)}`,
      spaetestens: (tag: Kalendertag) => `Spätestens ${formatDatum(tag)}`,
      schonVergeben: "Schon vergeben",
    },

    /** The three lines every refusal no person causes knowingly from the screen falls back to. */
    fehler: {
      unerwartet: UNERWARTET,
      veraltet: "Die Seite ist nicht mehr aktuell. Lade sie neu.",
      abgelaufen: "Deine Anmeldung ist abgelaufen. Melde dich neu an.",
    },

    /** Beside the save button once the record is stored. */
    gespeichert: "Gespeichert",

    /** The four toast titles; a toast carries no body. */
    toast: {
      kopiert: "Kopiert",
      linkGesendet: "Link gesendet",
      abgemeldet: "Abgemeldet",
      fehler: UNERWARTET,
    },

    /** The spinner's accessible name; a busy button keeps its own label. */
    laedt: "Lädt",

    /** The plural is the list's own title entry. */
    leer: {
      suche: (plural: Copy) => `Keine ${plural} für diese Suche.`,
      filter: (plural: Copy) => `Keine ${plural} für diese Filter.`,
      noch: (plural: Copy) => `Noch keine ${plural}.`,
    },

    /** „Passkey löschen?“: a confirmation asks with the verb its button carries. */
    frage: (objekt: Copy, verb: Verb) => `${objekt} ${infinitiv(verb)}?`,
    zurueck: "Zurück",

    /** The end states of a page a mail opens; each page names its own sentence for the done state. */
    ende: {
      erledigtAm: (erledigt: Copy, tag: Kalendertag) => `${erledigt} am ${formatDatumLang(tag)}.`,
      linkUngueltig: "Dieser Link gilt nicht mehr.",
      zurStartseite: "Zur Startseite",
      zumKonto: "Zum Konto",
    },

    nichtHinterlegt: "Nicht hinterlegt",
    uebersicht: "Übersicht",
    funktionWechseln: "Funktion wechseln",
    mehr: "Mehr …",
    weitereLaden: "Weitere 50 laden",
    protokoll: "Protokoll",
    kORunde: "K.-o.-Runde",
    kOBaum: "K.-o.-Baum",
    nachElfmeterschiessen: "n. E.",
    disqualifiziert: "DQ",
    startelf: "Startelf",
    bank: "Bank",
  },
});
