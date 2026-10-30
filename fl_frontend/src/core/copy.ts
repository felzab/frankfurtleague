import { KONTAKT_EMAIL } from "./brand";
import { formatDatum, formatDatumLang, formatDatumMitWochentag, formatErgebnis, formatUhrzeit, formatZahl } from "./format";

import type { Kalendertag, Paar, Uhrzeit } from "./format";

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

/**
 * The only assertion to `Copy`: the whole tree is branded at once, so no entry can be left plain. Exported for the
 * server's own catalogue, `serverCopy.ts`, alone.
 */
export const katalog = <const T>(baum: T): Katalog<T> => baum as Katalog<T>;

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

// One line for every failure no reason names, the same in a toast and in a status line.
const UNERWARTET = "Etwas ist schiefgelaufen";

// The mark a result decided in a shoot-out carries: under the score in a match row, after it in a fact.
const NACH_ELFMETERSCHIESSEN = "n. E.";

export const COPY = katalog({
  /** What every area draws from; an area adds a key of its own only for a string this lacks. */
  shared: {
    verb: VERB,
    /** „Team anlegen“: a button whose verb needs its object. */
    mitObjekt: (objekt: Copy, verb: Verb) => `${objekt} ${infinitiv(verb)}`,

    /** The units a field's figure is counted in, set after the field. */
    einheit: {
      euro: "€",
    },

    /** A field's one message line: what is expected, never the field's name. */
    feld: {
      pflichtfeld: "Pflichtfeld",
      hoechstensZeichen: (anzahl: number) => `Höchstens ${formatZahl(anzahl)} Zeichen`,
      mindestensZeichen: (anzahl: number) => `Mindestens ${formatZahl(anzahl)} Zeichen`,
      format: (beispiel: Copy) => `Format: ${beispiel}`,
      // A reserved domain, so no reader takes the example for the address the league expects.
      beispielAdresse: "name@example.com",
      // A digits field's example: figures alone, whatever the field counts.
      beispielZiffern: "123",
      // Redesign: the first field taking a range reads it.
      zwischen: (von: number, bis: number) => `Zwischen ${formatZahl(von)} und ${formatZahl(bis)}`,
      fruehestens: (tag: Kalendertag) => `Frühestens ${formatDatum(tag)}`,
      spaetestens: (tag: Kalendertag) => `Spätestens ${formatDatum(tag)}`,
      // A unique index's refusal: a field's message, and the words `serverCopy.ts` answers its code in.
      schonVergeben: "Schon vergeben",
    },

    /** The three lines every refusal no person causes knowingly from the screen falls back to. */
    fehler: {
      unerwartet: UNERWARTET,
      veraltet: "Die Seite ist nicht mehr aktuell. Lade sie neu.",
      abgelaufen: "Deine Anmeldung ist abgelaufen. Melde dich neu an.",
      /** The edge refused the press for its rate before anything behind it ran; the meter refills within the minute. */
      zuVieleVersuche: "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann erneut.",
      /** An administrator's grant is gone or was never held: no sign-in and no retry repairs it. */
      zugangWeg: "Dein Zugang zur Verwaltung besteht nicht mehr.",
      /** The backend left the grant unread: nothing ran, and a sign-in would meet the same outage. */
      zugangUngeprueft: "Dein Zugang zur Verwaltung ließ sich gerade nicht prüfen. Versuch es erneut.",
    },

    /** Beside the save button once the record is stored. */
    gespeichert: "Gespeichert",

    /** The four toast titles; a toast carries no body. */
    toast: {
      // Redesign: these three are read once copying, sending a link and signing out each toast through the kit.
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
    /** The name of the icon button closing a pop-up that asks nothing, such as the match pop-up. */
    schliessen: "Schließen",

    /** The end states of a page a mail opens; each page names its own sentence for the done state. */
    // Session 4: the mailed pages read these.
    ende: {
      erledigtAm: (erledigt: Copy, tag: Kalendertag) => `${erledigt} am ${formatDatumLang(tag)}.`,
      linkUngueltig: "Dieser Link gilt nicht mehr.",
      zurStartseite: "Zur Startseite",
      zumKonto: "Zum Konto",
    },

    /** The match pop-up's way to the match's own page. */
    zumSpiel: "Zum Spiel",
    // Redesign: the first fact its reader could supply, shown empty, reads it.
    nichtHinterlegt: "Nicht hinterlegt",
    uebersicht: "Übersicht",
    // Redesign: the account menu reads it once it offers a second role.
    funktionWechseln: "Funktion wechseln",
    mehr: "Mehr …",
    weitereLaden: "Weitere 50 laden",
    protokoll: "Protokoll",
    kORunde: "K.-o.-Runde",
    // Session 3: its page reads it.
    kOBaum: "K.-o.-Baum",
    nachElfmeterschiessen: NACH_ELFMETERSCHIESSEN,
    // Session 3: its page reads it.
    disqualifiziert: "DQ",
    // Redesign: a line-up's chips read these.
    startelf: "Startelf",
    bank: "Bank",

    /** The ⓘ's name, which its tooltip shows. */
    hilfe: "Hilfe",
    /** A phone's filter button, and the sheet it opens, closed by „Fertig“. */
    filter: "Filter",
    fertig: "Fertig",
    /** The season button's menu. */
    saison: "Saison",
    /** A season by its id, which is its year and so takes no thousands separator: „Saison 2027“. */
    saisonName: (id: string) => `Saison ${id}`,

    /** The bot check before a public send: refused, disturbed, not yet done, or not loaded at all. */
    pruefung: {
      bestaetigen: "Bestätige kurz, dass du ein Mensch bist.",
      gestoert: "Die Prüfung, ob du ein Mensch bist, ist gerade gestört. Versuche es später erneut.",
      nichtFertig: "Die Prüfung, ob du ein Mensch bist, ist noch nicht fertig. Versuche es gleich erneut.",
      nichtGeladen: `Die Prüfung, ob du ein Mensch bist, ließ sich nicht laden. Erlaube challenges.cloudflare.com in deinem Browser oder Werbeblocker und lade die Seite neu, oder schreib uns an ${KONTAKT_EMAIL}.`,
    },
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

  /** The Spielplan, and a match's page, which opens as the pop-up over it. */
  spielplan: {
    /** The matchday tabs' name, and the plural an empty Spielplan names. */
    spieltage: "Spieltage",
    /** When a match is played, as its row shows it; until it is dated, what is still to settle. */
    wann: (tag: Kalendertag | null, zeit: Uhrzeit | null) =>
      tag === null ? "Termin offen" : zeit === null ? formatDatumMitWochentag(tag) : `${formatDatumMitWochentag(tag)} · ${formatUhrzeit(zeit)}`,
    /** The score, a shoot-out's goals added to each side's, with the shoot-out's mark after it. */
    ergebnis: (tore: Paar, elfmeterschiessen: Paar | null) =>
      elfmeterschiessen === null ? formatErgebnis(tore) : `${formatErgebnis(tore, elfmeterschiessen)} ${NACH_ELFMETERSCHIESSEN}`,

    /** A side the draw has not settled: its source short in the dashed plaque, and in full as its name. */
    quelle: {
      gruppeKurz: (gruppe: string, platz: number) => `${gruppe}${formatZahl(platz)}`,
      gruppe: (gruppe: string, platz: number) => `${formatZahl(platz)}. der Gruppe ${gruppe}`,
      siegerKurz: (spiel: number) => `S${formatZahl(spiel)}`,
      sieger: (spiel: number) => `Sieger von Spiel ${formatZahl(spiel)}`,
      verliererKurz: (spiel: number) => `V${formatZahl(spiel)}`,
      verlierer: (spiel: number) => `Verlierer von Spiel ${formatZahl(spiel)}`,
      /** A side with neither a club nor a source yet. */
      offen: "Noch offen",
    },

    /** What befell a match, as a visitor reads it: a no-show names the club that did not turn up. */
    sonderereignis: {
      ausgefallen: "Ausgefallen",
      nichtAngetreten: (team: string) => `${team} nicht angetreten`,
      abgebrochen: "Abgebrochen",
      annulliert: "Annulliert",
      /**
       * What the event means for the result, under its name in the pop-up's callout: a match called off or
       * struck out awards nothing, a no-show awards the side that turned up the forfeit the season's rules
       * set, which the score shows, and an abandoned match owes a result until one is entered.
       */
      folge: {
        ausgefallen: "Das Spiel hat nicht stattgefunden und wird nicht gewertet.",
        nichtAngetreten: (gegner: string) => `Das Spiel wird für ${gegner} gewertet.`,
        abgebrochenGewertet: "Das Spiel wurde abgebrochen. Das eingetragene Ergebnis wird gewertet.",
        abgebrochenOffen: "Das Spiel wurde abgebrochen. Wie es gewertet wird, steht noch nicht fest.",
        annulliert: "Das Spiel wurde annulliert und wird nicht gewertet.",
      },
    },

    /** A match's facts, each by its label. */
    fakt: {
      ergebnis: "Ergebnis",
      sonderereignis: "Sonderereignis",
      spieltag: "Spieltag",
      datum: "Datum",
      uhrzeit: "Uhrzeit",
      ort: "Ort",
      schiedsrichter: "Schiedsrichter",
      notiz: "Notiz",
    },
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
    /** The account menu's theme choice, under the name of Konto's page for it: the system's, or one set here. */
    darstellung: { system: "System", hell: "Hell", dunkel: "Dunkel" },
    /** The strip's toggle folding the rail to its glyphs and back, named for what the next press does. */
    seitenleiste: { einklappen: "Seitenleiste einklappen", ausklappen: "Seitenleiste ausklappen" },

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

  /** Signing in: the address and its code, the passkey, and the answers either can meet. */
  anmeldung: {
    /** The tab titles of `/signin` and `/signin/passkey`. */
    titel: "Anmelden",
    passkeyTitel: "Passkey",

    adresse: "E-Mail-Adresse",
    codeSenden: "Code senden",
    oder: "oder",
    mitPasskey: "Mit Passkey anmelden",
    /** The bot check that did not load, naming the passkey, which signs in without it. */
    pruefungNichtGeladen: `Die Prüfung, ob du ein Mensch bist, ließ sich nicht laden. Erlaube challenges.cloudflare.com in deinem Browser oder Werbeblocker und lade die Seite neu, melde dich mit einem Passkey an oder schreib uns an ${KONTAKT_EMAIL}.`,

    /**
     * The code view: one sentence for every address, so it says nothing about who holds an account, in the two
     * parts around the address, which the template sets semibold between them.
     */
    postfach: "Prüfe dein Postfach",
    codeUnterwegs: { vor: "Falls zu", nach: "ein Konto gehört, ist ein Anmeldecode unterwegs." },
    /** The six boxes' accessible name: no label stands above them. */
    code: "Code aus der E-Mail",
    andereAdresse: "Andere E-Mail-Adresse verwenden",

    /** `/signin` for somebody already signed in, in the two parts around the address, as the code view's sentence. */
    angemeldetAls: { vor: "Du bist als", nach: "angemeldet." },

    passkey: {
      einrichten: { titel: "Passkey einrichten", satz: "Die Verwaltung ist erst mit einem Passkey erreichbar.", knopf: "Jetzt einrichten" },
      anmelden: { titel: "Mit Passkey anmelden", satz: "Melde dich mit dem Passkey an, den du eingerichtet hast.", knopf: "Jetzt anmelden" },
      angebot: {
        titel: "Passkey einrichten",
        satz: "Mit einem Passkey meldest du dich künftig sicher ohne Code an.",
        knopf: "Jetzt einrichten",
      },
      spaeter: "Später",
    },

    /**
     * The code's and the passkey's refusals: the code route answers them, and the page finds each one here
     * again. A barred address and one holding no record meet one sentence, so nobody can probe the ban list.
     */
    abgelehnt: {
      codeFalsch: "Der Code stimmt nicht oder gilt nicht mehr. Nimm den Code aus der neuesten E-Mail oder fordere einen neuen an.",
      codeAbgelaufen: "Der Code ist abgelaufen. Fordere einen neuen an.",
      codeZuOft: "Zu viele Versuche mit diesem Code. Fordere einen neuen an.",
      adresseZuOft: (stunden: number) =>
        `Zu viele Versuche mit dieser Adresse. Melde dich mit einem Passkey an oder versuche es in ${formatZahl(stunden)} Stunden erneut.`,
      codeVerbraucht:
        "Die Anmeldung hat gerade nicht geklappt, und dein Code ist damit verbraucht. Fordere in ein paar Minuten einen neuen an.",
      ohneEintrag: `Mit dieser Adresse ist derzeit keine Anmeldung möglich. Wenn du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}.`,
      ohneBestaetigung:
        "Dieser Passkey hat nicht bestätigt, dass du es bist. Nimm einen Passkey mit PIN, Fingerabdruck oder Gesichtserkennung.",
    },
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
      /** The create dialog's two groups: the address's lines, and the record's terms, the price among them. */
      adresse: "Adresse",
      konditionen: "Konditionen",
      strasse: "Straße",
      hausnummer: "Nr.",
      plz: "PLZ",
      stadtteil: "Stadtteil",
      stadt: "Stadt",
      /** What a new venue's city starts as: the league plays in one city. */
      stadtVorgabe: "Frankfurt am Main",
      mietpreis: "Mietpreis",
      /** The examples each box's message line shows where its value is off its pattern. */
      mietpreisBeispiel: "60",
      plzBeispiel: "60438",
      hausnummerBeispiel: "12a",
      stillgelegt: "Stillgelegt",
      /** The venue list's last entry, which opens the create dialog with the name typed so far. */
      anlegenEintrag: "Spielort anlegen …",
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
      /** The save's done line where the write moved other matches too, `folgen` naming them in today's editor's words. */
      gespeichertMitFolgen: (folgen: string) => `Gespeichert. ${folgen}`,
    },
  },

  /** The league's own name, which ends every tab title, and what an installed app calls itself. */
  marke: {
    name: "Frankfurt League",
    kurzname: "FL",
    beschreibung: "Die Frankfurt League ist die Oberstufenliga der Frankfurter Schulen. Finde heraus, welche Schule gewinnt!",
  },
});
