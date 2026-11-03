import { formatDatum, formatDatumLong, formatDatumWithWeekday, formatErgebnis, formatList, formatNumber, formatUhrzeit } from "./format";

import type { CalendarDay, Pair, Uhrzeit } from "./format";

declare const copyBrand: unique symbol;

/**
 * A string the catalogue wrote. Every kit text prop takes this type, so a string typed into a page
 * does not compile; `as Copy` outside this file is the one way round it.
 */
export type Copy = string & { readonly [copyBrand]: true };

type Catalogue<T> = T extends string
  ? Copy
  : T extends (...args: infer A) => string
    ? (...args: A) => Copy
    : { readonly [K in keyof T]: Catalogue<T[K]> };

/**
 * The only assertion to `Copy`: the whole tree is branded at once, so no entry can be left plain. Exported for the
 * server's own catalogue, `serverCopy.ts`, alone.
 */
export const catalogue = <const T>(tree: T): Catalogue<T> => tree as Catalogue<T>;

// Each label is the verb's infinitive capitalised, so `withObject` lower-cases its first letter alone.
const VERB = {
  create: "Anlegen",
  save: "Speichern",
  delete: "Löschen",
  remove: "Entfernen",
  withdraw: "Zurückziehen",
  deregister: "Austragen",
  send: "Senden",
  submit: "Abschicken",
  confirm: "Bestätigen",
  decline: "Ablehnen",
  oppose: "Widersprechen",
  adopt: "Übernehmen",
  discard: "Verwerfen",
  lineUp: "Aufstellen",
  signIn: "Anmelden",
  signOut: "Abmelden",
} as const;

/** The closed set of button verbs: a button names its act with one of these. */
export type Verb = keyof typeof VERB;

const infinitive = (verb: Verb): string => `${VERB[verb].charAt(0).toLowerCase()}${VERB[verb].slice(1)}`;

// One line for every failure no reason names, the same in a toast and in a status line.
const UNEXPECTED = "Etwas ist schiefgelaufen";

/** A range's end: a figure, or a year as a string, which as a season id takes no thousands separator. */
type Bound = number | string;

const bound = (value: Bound): string => (typeof value === "string" ? value : formatNumber(value));

// The mark a result decided in a shoot-out carries: under the score in a match row, after it in a fact.
const AFTER_ELFMETERSCHIESSEN = "n. E.";

export const COPY = catalogue({
  /** What every area draws from; an area adds a key of its own only for a string this lacks. */
  shared: {
    verb: VERB,
    /** „Team anlegen“: a button whose verb needs its object. */
    withObject: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}`,

    /** The units a field's figure is counted in, set after the field. */
    unit: {
      euro: "€",
    },

    /** A field's one message line: what is expected, never the field's name. */
    field: {
      required: "Pflichtfeld",
      maxChars: (count: number) => `Höchstens ${formatNumber(count)} Zeichen`,
      minChars: (count: number) => `Mindestens ${formatNumber(count)} Zeichen`,
      format: (example: Copy) => `Format: ${example}`,
      // A reserved domain, so no reader takes the example for the address the league expects.
      exampleAddress: "name@example.com",
      // A digits field's example: figures alone, whatever the field counts.
      exampleDigits: "123",
      exampleDate: "31.12.2026",
      // Reserved as the address example's domain is.
      exampleUrl: "https://example.com",
      // Redesign: the first field taking a range reads it.
      between: (from: Bound, to: Bound) => `Zwischen ${bound(from)} und ${bound(to)}`,
      // One-sided bounds of a number or of a list, the box's label saying what is counted.
      max: (count: number) => `Höchstens ${formatNumber(count)}`,
      min: (count: number) => `Mindestens ${formatNumber(count)}`,
      /** „Ohne E-Mail-Adresse“: what a text must not hold, by the catalogue's own name for it. */
      without: (thing: Copy) => `Ohne ${thing}`,
      earliest: (day: CalendarDay) => `Frühestens ${formatDatum(day)}`,
      latest: (day: CalendarDay) => `Spätestens ${formatDatum(day)}`,
      // A unique index's refusal: a field's message, and the words `serverCopy.ts` answers its code in.
      taken: "Schon vergeben",
    },

    /** The three lines every refusal no person causes knowingly from the screen falls back to. */
    failure: {
      unexpected: UNEXPECTED,
      stale: "Die Seite ist nicht mehr aktuell.",
      signInExpired: "Deine Anmeldung ist abgelaufen.",
      /** The edge refused the press for its rate before anything behind it ran; the meter refills within the minute. */
      tooManyAttempts: "Zu viele Versuche in kurzer Zeit.",
      /** An administrator's grant is gone or was never held: no sign-in and no retry repairs it. */
      accessGone: "Dein Zugang zur Verwaltung besteht nicht mehr.",
      /** The backend left the grant unread: nothing ran, and a sign-in would meet the same outage. */
      accessUnchecked: "Dein Zugang zur Verwaltung ließ sich gerade nicht prüfen.",
    },

    /** Beside the save button once the record is stored. */
    saved: "Gespeichert",

    /** The four toast titles; a toast carries no body. */
    toast: {
      // Redesign: these three are read once copying, sending a link and signing out each toast through the kit.
      copied: "Kopiert",
      linkSent: "Link gesendet",
      signedOut: "Abgemeldet",
      failure: UNEXPECTED,
    },

    /** The spinner's accessible name; a busy button keeps its own label. */
    loading: "Lädt",

    /** The plural is the list's own title entry. */
    empty: {
      search: (plural: Copy) => `Keine ${plural} für diese Suche.`,
      filter: (plural: Copy) => `Keine ${plural} für diese Filter.`,
      none: (plural: Copy) => `Noch keine ${plural}.`,
    },

    /** „Passkey löschen?“: a confirmation asks with the verb its button carries. */
    question: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}?`,
    back: "Zurück",
    /** The name of the icon button closing a pop-up that asks nothing, such as the match pop-up. */
    close: "Schließen",

    /** The end states of a page a mail opens; each page names its own sentence for the done state. */
    // Session 4: the mailed pages read these.
    end: {
      doneOn: (done: Copy, day: CalendarDay) => `${done} am ${formatDatumLong(day)}.`,
      linkInvalid: "Dieser Link gilt nicht mehr.",
      toHome: "Zur Startseite",
      toAccount: "Zum Konto",
    },

    /** The match pop-up's way to the match's own page. */
    toSpiel: "Zum Spiel",
    // Redesign: the first fact its reader could supply, shown empty, reads it.
    notProvided: "Nicht hinterlegt",
    overview: "Übersicht",
    // Redesign: the account menu reads it once it offers a second role.
    switchRole: "Funktion wechseln",
    loadMore: "Weitere 50 laden",
    kORunde: "K.-o.-Runde",
    kOBaum: "K.-o.-Baum",
    /** The one German spelling of each phase, which `PHASE_LABELS` serves to every surface. */
    phase: {
      gruppenphase: "Gruppenphase",
      achtelfinale: "Achtelfinale",
      viertelfinale: "Viertelfinale",
      halbfinale: "Halbfinale",
      finale: "Finale",
    },
    /** A group matchday, by its served `position`: the season's lists, a match's head and the season card name it alike. */
    spieltag: (position: number) => `${formatNumber(position)}. Spieltag`,
    afterElfmeterschiessen: AFTER_ELFMETERSCHIESSEN,
    /**
     * The two routes out of a season, each in its three wordings: `label` names the record, `zustand` the club's
     * resulting state, `kuerzel` the badge. `AUSTRITT_OPTIONS` serves them to every surface, so no two can name
     * one record differently.
     */
    austritt: {
      disqualifikation: { label: "Disqualifikation", zustand: "Disqualifiziert", kuerzel: "DQ" },
      rueckzug: { label: "Rückzug", zustand: "Zurückgezogen", kuerzel: "RZ" },
    },
    /** The head of a club's exit note, „Disqualifiziert seit 14.03.2026“: its route's `zustand` and the day it took effect. */
    austrittSeit: (zustand: Copy, day: CalendarDay) => `${zustand} seit ${formatDatum(day)}`,
    startelf: "Startelf",
    bank: "Bank",

    /**
     * The kit's season blocks that a client component draws: a table's rows reach the list's client table. The
     * rest, which only the server draws, stand in `SERVER_COPY.season`.
     */
    season: {
      /** The name of the mark beside a club's figure: how many of its fixtures were called off. */
      cancelled: (count: number) => (count === 1 ? "1 Spiel abgesagt" : `${formatNumber(count)} Spiele abgesagt`),
      /** The mark itself, drawn red on the corner of a club's figure and hidden from a screen reader, which hears `cancelled`. */
      cancelledMark: (count: number) => `+${formatNumber(count)}`,
    },

    /** The ⓘ's name, which its tooltip shows. */
    help: "Hilfe",
    /** A phone's filter button, and the sheet it opens, closed by „Fertig“. */
    filter: "Filter",
    done: "Fertig",
    /** The season button's menu. */
    saison: "Saison",
    /** A season by its id, which is its year and so takes no thousands separator: „Saison 2027“. */
    saisonName: (id: string) => `Saison ${id}`,

    /** The bot check before a public send: refused, disturbed, not yet done, or not loaded at all. */
    botCheck: {
      confirm: "Die Bestätigung, dass du ein Mensch bist, fehlt.",
      disrupted: "Die Prüfung, ob du ein Mensch bist, ist gerade gestört.",
      notReady: "Die Prüfung, ob du ein Mensch bist, ist noch nicht fertig.",
      notLoaded: "Die Prüfung, ob du ein Mensch bist, ließ sich nicht laden.",
    },
  },

  /**
   * Each page's own name, which its tab title and its strip show, keyed by its `ROUTES` key; a name several pages
   * share is one entry, keyed by its noun.
   */
  page: {
    spielplan: "Spielplan",
    tabelle: "Tabelle",
    teams: "Teams",
    spielSearch: "Spielsuche",
    /** A match's page, named by its two teams in the order the fixture lists them. */
    spiel: (heim: string, gast: string) => `${heim} gegen ${gast}`,
    /** A club's page in one season, named by the club. */
    team: (team: string) => team,
    about: "Über die Liga",
    contact: "Kontakt",
    sponsors: "Sponsoren",
    legalNotice: "Impressum",
    privacyNotice: "Datenschutz",
    accountSignIn: "Anmeldung",
    accountSecurity: "Sicherheit",
    accountAppearance: "Darstellung",
    accountEntries: "Deine Einträge",
    verwaltungSaisons: "Saisons",
    spiele: "Spiele",
    verwaltungSpielorte: "Spielorte",
    verwaltungSchiedsrichter: "Schiedsrichter",
    verwaltungBewerbungen: "Bewerbungen",
    verwaltungSpieler: "Spieler",
    registrierungen: "Registrierungen",
    teamKader: "Kader",
    verwaltungAdministrators: "Administratoren",
    verwaltungSperrliste: "Sperrliste",
    verwaltungErasures: "Löschungen",
    verwaltungAddressChanges: "Adressänderungen",
    verwaltungActionLog: "Protokoll",
    addressChangeConfirmation: "Änderung der E-Mail-Adresse",
    /** A contact person's and a referee's confirmation of their own entry. */
    entryConfirmation: "Eintrag bestätigen",
    spielbestaetigung: "Spieltermin bestätigen",
    registrierungConfirmation: "Registrierung bestätigen",
    accountErasure: "Konto löschen",
    registrierung: "Registrierung",
  },

  /** The Spielplan, and a match's page, which opens as the pop-up over it. */
  spielplan: {
    /** The matchday tabs' name, and the plural an empty Spielplan names. */
    spieltage: "Spieltage",
    /** When a match is played, as its row shows it; until it is dated, what is still to settle. */
    when: (day: CalendarDay | null, time: Uhrzeit | null) =>
      day === null ? "Termin offen" : time === null ? formatDatumWithWeekday(day) : `${formatDatumWithWeekday(day)} · ${formatUhrzeit(time)}`,
    /** The score, a shoot-out's goals added to each side's, with the shoot-out's mark after it. */
    ergebnis: (tore: Pair, elfmeterschiessen: Pair | null) =>
      elfmeterschiessen === null ? formatErgebnis(tore) : `${formatErgebnis(tore, elfmeterschiessen)} ${AFTER_ELFMETERSCHIESSEN}`,

    /** A side the draw has not settled: its source short in the dashed plaque, and in full as its name. */
    quelle: {
      gruppeShort: (gruppe: string, platz: number) => `${gruppe}${formatNumber(platz)}`,
      gruppe: (gruppe: string, platz: number) => `${formatNumber(platz)}. der Gruppe ${gruppe}`,
      siegerShort: (spiel: number) => `S${formatNumber(spiel)}`,
      sieger: (spiel: number) => `Sieger von Spiel ${formatNumber(spiel)}`,
      verliererShort: (spiel: number) => `V${formatNumber(spiel)}`,
      verlierer: (spiel: number) => `Verlierer von Spiel ${formatNumber(spiel)}`,
      /** A side with neither a club nor a source yet. */
      open: "Noch offen",
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
      consequence: {
        ausgefallen: "Das Spiel hat nicht stattgefunden und wird nicht gewertet.",
        nichtAngetreten: (gegner: string) => `Das Spiel wird für ${gegner} gewertet.`,
        abgebrochenScored: "Das eingetragene Ergebnis wird gewertet.",
        abgebrochenOpen: "Die Wertung steht noch nicht fest.",
        annulliert: "Das Spiel wurde annulliert und wird nicht gewertet.",
      },
    },

    /** A match's facts, each by its label. */
    fact: {
      ergebnis: "Ergebnis",
      sonderereignis: "Sonderereignis",
      spieltag: "Spieltag",
      datum: "Datum",
      uhrzeit: "Uhrzeit",
      spielort: "Ort",
      schiedsrichter: "Schiedsrichter",
      notiz: "Notiz",
    },
  },

  /** The page templates' own words: the frames around a page, the editor's bar, a list's paging, the end states. */
  template: {
    /** The phone bar's place opening the rest of the menu, and the link at the end of a folded text's third line. */
    more: "Mehr",
    /** The name of a frame's menu, the rail's and the phone bar's. */
    navigation: "Navigation",
    /** The account's place: the rail's account row and the phone bar's avatar. */
    account: "Konto",
    /** The classic header's button opening its links on a phone. */
    menu: "Menü",
    /** The account menu's theme choice, under the name of Konto's page for it: the system's, or one set here. */
    theme: { system: "System", light: "Hell", dark: "Dunkel" },
    /** The strip's toggle folding the rail to its glyphs and back, named for what the next press does. */
    sidebar: { collapse: "Seitenleiste einklappen", expand: "Seitenleiste ausklappen" },

    /** The footer: the league's group, which holds the sponsors' page, and the line over the sponsors' logos. */
    liga: "Liga",
    oberstufenliga: "Die Frankfurter Oberstufenliga",
    supportedBy: "Mit Unterstützung von",
    instagram: "Instagram",
    threads: "Threads",
    copyright: (year: number, brand: Copy) => `© ${String(year)} ${brand}`,

    /** An editor's changes not yet saved: the status line names their count, the discard dialog asks before they go. */
    changes: "Änderungen",
    changesPending: (count: number) => (count === 1 ? "1 Änderung" : `${formatNumber(count)} Änderungen`),
    changesLost: (count: number) => (count === 1 ? "1 Änderung geht verloren." : `${formatNumber(count)} Änderungen gehen verloren.`),
    /** A save refused for its fields: the fields say what, the status line that some are off. */
    checkFields: "Einige Felder sind nicht richtig ausgefüllt.",

    /** A page a mail opened whose link no longer holds, above the catalogue's sentence for it. */
    linkInvalid: "Link nicht mehr gültig",
  },

  /** Signing in: the address and its code, the passkey, and the answers either can meet. */
  signIn: {
    /** `/signin`'s tab title, and its card's heading, signed out and signed in. */
    title: "Anmelden",
    passkeyTitle: "Passkey",
    /** `/signin/weiter`'s tab title, a page that only sends the session on to where it goes next. */
    landingTitle: "Anmeldung",

    address: "E-Mail-Adresse",
    sendCode: "Code senden",
    or: "oder",
    withPasskey: "Mit Passkey anmelden",

    /**
     * The code view: one sentence for every address, so it says nothing about who holds an account, in the two
     * parts around the address, which the template sets semibold between them.
     */
    inbox: "Prüfe dein Postfach",
    codeOnItsWay: { before: "Falls zu", after: "ein Konto gehört, ist ein Anmeldecode unterwegs." },
    /** The six boxes' accessible name: no label stands above them. */
    code: "Code aus der E-Mail",
    otherAddress: "Andere E-Mail-Adresse verwenden",

    /** `/signin` for somebody already signed in, in the two parts around the address, as the code view's sentence. */
    signedInAs: { before: "Du bist als", after: "angemeldet." },

    passkey: {
      setUp: { title: "Passkey einrichten", sentence: "Die Verwaltung ist erst mit einem Passkey erreichbar.", button: "Jetzt einrichten" },
      signIn: { title: "Mit Passkey anmelden", sentence: "Melde dich mit dem Passkey an, den du eingerichtet hast.", button: "Jetzt anmelden" },
      offer: {
        title: "Passkey einrichten",
        sentence: "Mit einem Passkey meldest du dich künftig sicher ohne Code an.",
        button: "Jetzt einrichten",
      },
      later: "Später",
    },

    /**
     * The code's and the passkey's refusals: the code route answers them, and the page finds each one here
     * again. A barred address and one holding no record meet one sentence, so nobody can probe the ban list.
     * The typed code's own refusal is a phrase under its boxes; every other is a sentence on the status line.
     */
    refusal: {
      codeWrong: "Falsch oder nicht mehr gültig",
      codeExpired: "Der Code ist abgelaufen.",
      codeTooOften: "Zu viele Versuche mit diesem Code.",
      addressTooOften: (hours: number) => `Mit dieser Adresse geht die Anmeldung per Code erst in ${formatNumber(hours)} Stunden wieder.`,
      codeUsedUp: "Die Anmeldung hat nicht geklappt, und dein Code ist verbraucht.",
      noRecord: "Mit dieser Adresse ist derzeit keine Anmeldung möglich.",
      unverified: "Dieser Passkey hat nicht bestätigt, dass du es bist.",
    },
  },

  /** The administration's own words: its frame, the Spielorte list, the match editor and the season editor. */
  verwaltung: {
    /** The role an administrator acts in, the account row's second line. */
    role: "Verwaltung",
    /** The rail's headings over its groups; the Übersicht stands above them with none. */
    group: {
      saisonsAndSpiele: "Saisons und Spiele",
      schulenAndSpieler: "Schulen und Spieler",
      accessAndPrivacy: "Zugang und Datenschutz",
    },
    /** A record's own page, named by the record. */
    record: (name: string) => name,

    spielort: {
      /** The object of „Spielort anlegen“. */
      object: "Spielort",
      search: "Spielorte suchen",
      name: "Name",
      /** The create dialog's two groups: the address's lines, and the record's terms, the price among them. */
      address: "Adresse",
      terms: "Konditionen",
      strasse: "Straße",
      hausnummer: "Nr.",
      plz: "PLZ",
      stadtteil: "Stadtteil",
      stadt: "Stadt",
      /** What a new venue's city starts as: the league plays in one city. */
      stadtDefault: "Frankfurt am Main",
      mietpreis: "Mietpreis",
      /** The examples each box's message line shows where its value is off its pattern. */
      mietpreisExample: "60",
      plzExample: "60438",
      hausnummerExample: "12a",
      retired: "Stillgelegt",
      /** The venue list's last entry, which opens the create dialog with the name typed so far. */
      createEntry: "Spielort anlegen",
      /** One line of a venue's address: its street and number. */
      strasseWithHausnummer: (strasse: string, hausnummer: string) => `${strasse} ${hausnummer}`,
    },

    saison: {
      /** Under the season's start once a result is entered, which holds it. */
      startFixed: "Steht fest, seit ein Ergebnis eingetragen ist",
    },

    spiel: {
      /** The editor of a match whose two teams are not both known yet, named by its number. */
      number: (nr: number) => `Spiel ${formatNumber(nr)}`,
      ansetzung: "Ansetzung",
      ergebnis: "Ergebnis",
      /** A result's goals and the players credited with them, as a field's message names what it must not hold. */
      tore: "Tore",
      torschuetzen: "Torschützen",
      notiz: "Notiz",
      datum: "Datum",
      uhrzeit: "Uhrzeit",
      sonderereignis: "Sonderereignis",
      /** The Sonderereignis' first entry: nothing beyond the match being played. */
      none: "Keines",
      ausgefallen: "Ausgefallen",
      nichtantretenTeam1: "Nichtantreten Team 1",
      nichtantretenTeam2: "Nichtantreten Team 2",
      /** The fixture's two sides, by the names the Sonderereignis' entries give them. */
      team1: "Team 1",
      team2: "Team 2",
      abgebrochen: "Abgebrochen",
      annulliert: "Annulliert",
      /** Why a no-show cannot be picked while a side is open. */
      needsBothSides: "Nur mit beiden Teams",
      /** The save's done line where the write moved other matches too, by their numbers: „Auch Spiel 5 und 7 geändert“. */
      alsoChanged: (spiele: readonly number[]) => `Auch Spiel ${formatList(spiele.map(formatNumber))} geändert`,
    },
  },

  /** The landing's words a client component reads; the rest stand in `SERVER_COPY.landing`. */
  landing: {
    /** The countdown's units, under its three figures. Board: their words. */
    saison: { days: "Tage", hours: "Stunden", minutes: "Minuten" },
  },

  /** The league's own name, which ends every tab title, and what an installed app calls itself. */
  brand: {
    name: "Frankfurt League",
    shortName: "FL",
    description:
      "Die Frankfurt League ist die Fußballliga der Frankfurter Oberstufen. Abi-Jahrgänge spielen 11 gegen 11 um den Titel. Jedes Spiel bringt Geld für den Abiball.",
  },
});
