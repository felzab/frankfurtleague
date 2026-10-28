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

    /** The ⓘ's name, which its tooltip shows. */
    hilfe: "Hilfe",
    /** A phone's filter button, and the sheet it opens, closed by „Fertig“. */
    filter: "Filter",
    fertig: "Fertig",
    /** The season button's menu. */
    saison: "Saison",
  },

  /** Each page's own name, which its tab title and its strip show; the route table names the key. */
  seite: {
    spielplan: "Spielplan",
    tabelle: "Tabelle",
    teams: "Teams",
    spielsuche: "Spielsuche",
    /** A match's page, named by its two teams in the order the fixture lists them. */
    spiel: (heim: string, gast: string) => `${heim} gegen ${gast}`,
    about: "About",
    kontakt: "Kontakt",
    sponsoren: "Sponsoren",
    impressum: "Impressum",
    datenschutz: "Datenschutz",
    anmeldung: "Anmeldung",
    sicherheit: "Sicherheit",
    darstellung: "Darstellung",
    deineEintraege: "Deine Einträge",
    saisons: "Saisons",
    spiele: "Spiele",
    spielorte: "Spielorte",
    schiedsrichter: "Schiedsrichter",
    bewerbungen: "Bewerbungen",
    spieler: "Spieler",
    registrierungen: "Registrierungen",
    kader: "Kader",
    administratoren: "Administratoren",
    sperrliste: "Sperrliste",
    loeschungen: "Löschungen",
    adressaenderungen: "Adressänderungen",
  },

  /** The page templates' own words: the frames around a page, the editor's bar, a list's paging, the end states. */
  vorlage: {
    /** The phone bar's place opening the rest of the menu, without the ellipsis a truncated text's link takes. */
    mehr: "Mehr",
    /** The name of a frame's menu, the rail's and the phone bar's. */
    navigation: "Navigation",
    /** The account's place: the rail's account row and the phone bar's avatar. */
    konto: "Konto",
    /** The classic header's button opening its links on a phone. */
    menue: "Menü",

    /** The footer: the league's group, which holds the sponsors' page, and the line over the sponsors' logos. */
    liga: "Liga",
    oberstufenliga: "Die Frankfurter Oberstufenliga",
    mitUnterstuetzungVon: "Mit Unterstützung von",
    instagram: "Instagram",
    threads: "Threads",
    copyright: (jahr: number, marke: Copy) => `© ${String(jahr)} ${marke}`,

    /** An editor's changes not yet saved: the status line names their count, the discard dialog asks before they go. */
    aenderungen: "Änderungen",
    aenderungenOffen: (anzahl: number) => (anzahl === 1 ? "1 Änderung" : `${formatZahl(anzahl)} Änderungen`),
    aenderungenVerloren: (anzahl: number) => (anzahl === 1 ? "1 Änderung geht verloren." : `${formatZahl(anzahl)} Änderungen gehen verloren.`),
    /** A save refused for its fields: the fields say what, the status line says where to look. */
    felderPruefen: "Prüfe die markierten Felder.",

    /** A page a mail opened whose link no longer holds, above the catalogue's sentence for it. */
    linkUngueltig: "Link nicht mehr gültig",
  },

  /** The administration's own words: its frame, the Spielorte list and the match editor. */
  verwaltung: {
    /** The role an administrator acts in, the account row's second line. */
    rolle: "Verwaltung",
    /** The rail's headings over its groups; the Übersicht stands above them with none. */
    gruppe: {
      saisonsUndSpiele: "Saisons und Spiele",
      schulenUndSpieler: "Schulen und Spieler",
      zugangUndDatenschutz: "Zugang und Datenschutz",
    },
    /** A record's own page, named by the record. */
    datensatz: (name: string) => name,

    spielort: {
      /** The object of „Spielort anlegen“. */
      objekt: "Spielort",
      suchen: "Spielorte suchen",
      name: "Name",
      adresse: "Adresse",
      strasse: "Straße",
      hausnummer: "Nr.",
      plz: "PLZ",
      stadtteil: "Stadtteil",
      stadt: "Stadt",
      /** What a new venue's city starts as: the league plays in one city. */
      stadtVorgabe: "Frankfurt am Main",
      mietpreis: "Mietpreis",
      /** The example a figure's message line shows. */
      mietpreisBeispiel: "60",
      stillgelegt: "Stillgelegt",
      /** One line of a venue's address: its street and number. */
      strasseMitNummer: (strasse: string, hausnummer: string) => `${strasse} ${hausnummer}`,
    },

    spiel: {
      /** The editor of a match whose two teams are not both known yet, named by its number. */
      nummer: (nummer: number) => `Spiel ${formatZahl(nummer)}`,
      ansetzung: "Ansetzung",
      ergebnis: "Ergebnis",
      notiz: "Notiz",
      datum: "Datum",
      uhrzeit: "Uhrzeit",
      sonderereignis: "Sonderereignis",
      /** The Sonderereignis' first entry: nothing beyond the match being played. */
      keines: "Keines",
      ausgefallen: "Ausgefallen",
      nichtantretenTeam1: "Nichtantreten Team 1",
      nichtantretenTeam2: "Nichtantreten Team 2",
      abgebrochen: "Abgebrochen",
      annulliert: "Annulliert",
      /** Why a no-show cannot be picked while a side is open. */
      beideSeitenNoetig: "beide Seiten nötig",

      /** The save's refusals, by the rule the backend names, in the words today's editor shows. */
      abgelehnt: {
        datumAusserhalb: "Dieses Datum liegt außerhalb des Spieltags.",
        unbestaetigt: "Diese Schiedsrichterin oder dieser Schiedsrichter hat den eigenen Eintrag noch nicht bestätigt.",
        teamMitErgebnis:
          "Dieses Spiel hat ein Ergebnis, deshalb lässt sich das Team nicht entfernen. Wähle ein anderes Team, oder lösche zuerst die Tore.",
        stillgelegt:
          "Spielort oder Schiedsrichter ist stillgelegt oder gelöscht und kann keinem Spiel neu zugeteilt werden, auch keinem, dessen Absage oder Ergebnis du gerade entfernst. Wähle einen anderen, oder reaktiviere den Eintrag, falls er nur stillgelegt ist.",
        zeitgleich:
          "Spielort oder Schiedsrichter ist zu dieser Zeit schon für ein anderes Spiel eingeteilt. Wähle eine Uhrzeit mit mindestens vier Stunden Abstand, oder teile das Spiel anders ein.",
        doppeltAmSpieltag:
          "Mit dieser Änderung würde der KO-Baum ein Team in zwei Spielen desselben Spieltags aufstellen. Gib einer der beiden Seiten eine andere Herkunft, oder nimm ein von Hand gesetztes Team aus einem der beiden Spiele.",
        ausgeschieden: "Dieses Team ist aus der Saison ausgeschieden und darf ab seinem Austritt nicht mehr aufgestellt sein.",
        nichtInSaison: "Dieses Team nimmt nicht an dieser Saison teil.",
        ohneWertung: "Ein Spiel mit diesem Sonderereignis wird nicht gewertet. Entferne zuerst die Tore.",
        beideTeamsNoetig: "Ein Nichtantreten braucht beide Teams. Besetze zuerst den offenen Platz.",
        schonAmSpieltag: "Dieses Team spielt am selben Spieltag schon in einem anderen Spiel.",
      },
    },
  },

  /** The league's own name, which ends every tab title, and what an installed app calls itself. */
  marke: {
    name: "Frankfurt League",
    kurzname: "FL",
    beschreibung: "Die Frankfurt League ist die Oberstufenliga der Frankfurter Schulen. Finde heraus, welche Schule gewinnt!",
  },
});
