import { formatDatum, formatDatumLong, formatDatumWithWeekday, formatList, formatNumber, formatOrdinal, formatUhrzeit } from "./format";

import type { CalendarDay, Uhrzeit } from "./format";

declare const copyBrand: unique symbol;

/**
 * A string the catalogue wrote. Every kit text prop takes this type, so a string typed into a page
 * does not compile; `as Copy` outside this file is the one way round it.
 */
export type Copy = string & { readonly [copyBrand]: true };

/**
 * A record's own data where words stand, such as a club's name or a figure it holds: not the catalogue's words, and
 * marked as data so a string typed into a page has no way into a text slot. Lint refuses a literal inside one.
 */
export type RecordText = { readonly record: string };

/** What a kit text slot shows: the catalogue's words, or a record's own data. */
export type Words = Copy | RecordText;

/** The text a slot shows. */
export const textOf = (words: Words): string => (typeof words === "string" ? words : words.record);

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

// The glossary's one spelling, which the season editor's sentence about it takes too.
const K_O_RUNDE = "K.-o.-Runde";

// Words two areas of this one object say alike, each written once and read under both keys: a match's facts and
// its events as a visitor reads them and as the editor's fields name them, and the sign-in's acts and pages.
const SPIEL_FACT = { datum: "Datum", uhrzeit: "Uhrzeit" } as const;
const SONDEREREIGNIS = { ausgefallen: "Ausgefallen", abgebrochen: "Abgebrochen", annulliert: "Annulliert" } as const;
const ANMELDUNG = "Anmeldung";
const MIT_PASSKEY_ANMELDEN = "Mit Passkey anmelden";
const PASSKEY_EINRICHTEN = { title: "Passkey einrichten", button: "Jetzt einrichten" } as const;

/**
 * A range's end: a figure, or a year, which as a season id takes no thousands separator. A year is data, never a
 * string, so no entry taking a bound passes a caller's words through as the catalogue's.
 */
type Bound = number | { year: number };

const bound = (value: Bound): string => (typeof value === "number" ? formatNumber(value) : String(value.year));

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
    // Session 4: the mailed pages read `doneOn` and `toAccount`.
    end: {
      doneOn: (done: Copy, day: CalendarDay) => `${done} am ${formatDatumLong(day)}.`,
      linkInvalid: "Dieser Link gilt nicht mehr.",
      toHome: "Zur Startseite",
      toAccount: "Zum Konto",
    },

    /** The match pop-up's way to the match's own page. */
    toSpiel: "Zum Spiel",
    /** A fact nobody has entered, where a sentence names it in words rather than a glyph: a match mail's ground. */
    notProvided: "Nicht hinterlegt",
    /** A value not there yet, in a tile, a table cell or a score's place: a glyph, not a word. */
    noValue: "–",
    /** Between a pairing's two sides where no score stands between them, as a fixture's pairing reads: a glyph, not a word. */
    versus: "–",
    overview: "Übersicht",
    // Redesign: the account menu reads it once it offers a second role.
    switchRole: "Funktion wechseln",
    loadMore: "Weitere 50 laden",
    kORunde: K_O_RUNDE,
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
    spieltag: (position: number) => `${formatOrdinal(position)} Spieltag`,
    /** A knockout matchday where its phase spans several, „Viertelfinale (2)“: the phase's name and the matchday's place in it. */
    knockoutRound: (phase: Copy, position: number) => `${phase} (${formatNumber(position)})`,
    /** The mark a result decided in a shoot-out carries, under the score in a match row and a match's head. */
    afterElfmeterschiessen: "n. E.",
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
    /** A club's goals, a match's and a season's: a column head, a tile, a field's message. */
    tore: "Tore",
    /** A record's name: a box's label, a list's column head. */
    name: "Name",

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
    spiel: (team1: Words, team2: Words) => `${textOf(team1)} gegen ${textOf(team2)}`,
    about: "Über die Liga",
    contact: "Kontakt",
    sponsors: "Sponsoren",
    legalNotice: "Impressum",
    privacyNotice: "Datenschutz",
    accountSignIn: ANMELDUNG,
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
    bewerbung: (saison: string) => `Bewerbung Saison ${saison}`,
  },

  /** The Spielplan, and a match's page, which opens as the pop-up over it. */
  spielplan: {
    /** The matchday tabs' name, and the plural an empty Spielplan names. */
    spieltage: "Spieltage",
    /** When a match is played, as its row shows it; until it is dated, what is still to settle. */
    when: (day: CalendarDay | null, time: Uhrzeit | null) =>
      day === null ? "Termin offen" : time === null ? formatDatumWithWeekday(day) : `${formatDatumWithWeekday(day)} · ${formatUhrzeit(time)}`,

    /** A side the draw has not settled: its source short in the dashed plaque, and in full as its name. */
    quelle: {
      gruppeShort: (gruppe: string, platz: number) => `${gruppe}${formatNumber(platz)}`,
      gruppe: (gruppe: string, platz: number) => `${formatOrdinal(platz)} der Gruppe ${gruppe}`,
      siegerShort: (spiel: number) => `S${formatNumber(spiel)}`,
      sieger: (spiel: number) => `Sieger von Spiel ${formatNumber(spiel)}`,
      verliererShort: (spiel: number) => `V${formatNumber(spiel)}`,
      verlierer: (spiel: number) => `Verlierer von Spiel ${formatNumber(spiel)}`,
      /** A side with neither a club nor a source yet. */
      open: "Noch offen",
    },

    /** What befell a match, as a visitor reads it: a no-show names the club that did not turn up. */
    sonderereignis: {
      ausgefallen: SONDEREREIGNIS.ausgefallen,
      nichtAngetreten: (team: Words) => `${textOf(team)} nicht angetreten`,
      abgebrochen: SONDEREREIGNIS.abgebrochen,
      annulliert: SONDEREREIGNIS.annulliert,
      /**
       * What the event means for the result, under its name in the pop-up's callout: a match called off or
       * struck out awards nothing, a no-show awards the side that turned up the forfeit the season's rules
       * set, which the score shows, and an abandoned match owes a result until one is entered.
       */
      consequence: {
        ausgefallen: "Das Spiel hat nicht stattgefunden und wird nicht gewertet.",
        nichtAngetreten: (gegner: Words) => `Das Spiel wird für ${textOf(gegner)} gewertet.`,
        abgebrochenScored: "Das eingetragene Ergebnis wird gewertet.",
        abgebrochenOpen: "Die Wertung steht noch nicht fest.",
        annulliert: "Das Spiel wurde annulliert und wird nicht gewertet.",
      },
    },

    /** A match's facts, each by its label. */
    fact: {
      spieltag: "Spieltag",
      datum: SPIEL_FACT.datum,
      uhrzeit: SPIEL_FACT.uhrzeit,
      spielort: "Ort",
      schiedsrichter: "Schiedsrichter",
    },
  },

  /** The page templates' own words: the frames around a page, the editor's bar, a list's paging, the end states. */
  template: {
    /** The phone bar's place opening the rest of the menu, and the link at the end of a folded text's third line. */
    more: "Mehr",
    /** The same link once the folded text is open, naming the press that folds it again. */
    less: "Weniger",
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

    /** The footer: the league's group, which holds the sponsors' page, the legal pages' group, and the line over the sponsors' logos. */
    liga: "Liga",
    legal: "Rechtliches",
    oberstufenliga: "Die Frankfurter Oberstufenliga",
    supportedBy: "Mit Unterstützung von",
    instagram: "Instagram",
    threads: "Threads",
    copyright: (year: number, brand: Copy) => `© ${String(year)} ${brand}`,

    /** An editor's changes not yet saved: the status line names their count, the discard dialog asks before they go. */
    changes: "Änderungen",
    changesPending: (count: number) => (count === 1 ? "1 Änderung" : `${formatNumber(count)} Änderungen`),
    changesLost: (count: number) => (count === 1 ? "1 Änderung geht verloren." : `${formatNumber(count)} Änderungen gehen verloren.`),
    /** The chip after an editor's title while its record is closed read-only, its season finished. */
    closed: "Abgeschlossen",
    /** A save refused for its fields: the fields say what, the status line that some are off. */
    checkFields: "Einige Felder sind nicht richtig ausgefüllt.",

    /** A page a mail opened whose link no longer holds, above the catalogue's sentence for it. */
    linkInvalid: "Link nicht mehr gültig",
  },

  /** Signing in: the address and its code, the passkey, and the answers either can meet. */
  signIn: {
    /** `/signin`'s tab title, and its card's heading, signed out and signed in: the act its button names. */
    title: VERB.signIn,
    passkeyTitle: "Passkey",
    /** `/signin/weiter`'s tab title, a page that only sends the session on to where it goes next. */
    landingTitle: ANMELDUNG,

    address: "E-Mail-Adresse",
    sendCode: "Code senden",
    or: "oder",
    withPasskey: MIT_PASSKEY_ANMELDEN,

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
      setUp: { ...PASSKEY_EINRICHTEN, sentence: "Die Verwaltung ist erst mit einem Passkey erreichbar." },
      signIn: { title: MIT_PASSKEY_ANMELDEN, sentence: "Melde dich mit dem Passkey an, den du eingerichtet hast.", button: "Jetzt anmelden" },
      offer: { ...PASSKEY_EINRICHTEN, sentence: "Mit einem Passkey meldest du dich künftig sicher ohne Code an." },
      later: "Später",
    },

    /**
     * The code's and the passkey's refusals, which the page words off the library's own codes
     * (`fl_frontend/src/features/auth/signInAnswers.ts`, `passkeyAnswers.ts`). A barred address and one holding
     * no record meet one sentence, so nobody can probe the ban list.
     * The typed code's own refusal is a phrase under its boxes; every other is a sentence on the status line.
     */
    refusal: {
      codeWrong: "Falsch oder nicht mehr gültig",
      codeExpired: "Der Code ist abgelaufen.",
      codeTooOften: "Zu viele Versuche mit diesem Code.",
      addressTooOften: "Zu viele Versuche mit dieser Adresse.",
      codeUsedUp: "Die Anmeldung hat nicht geklappt, und dein Code ist verbraucht.",
      noRecord: "Mit dieser Adresse ist derzeit keine Anmeldung möglich.",
      unverified: "Dieser Passkey hat nicht bestätigt, dass du es bist.",
      /** An act the passkey touch guards, sent without a passkey sign-in of the last minute by a person holding one. */
      touchMissing: "Die Bestätigung mit deinem Passkey fehlt.",
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

    spielort: {
      /** The object of „Spielort anlegen“. */
      object: "Spielort",
      search: "Spielorte suchen",
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
      /** A whole address on one line, „Schulweg 8, 60317 Frankfurt am Main“, after its street line. */
      addressLine: (street: Copy, plz: string, stadt: string) => `${street}, ${plz} ${stadt}`,
    },

    saison: {
      /**
       * The groups and the qualifiers per group multiply to no bracket the league plays: the form's own check, the
       * rules write's refusal and the draw's say it alike, on the status line, the two counts together being at fault.
       */
      bracketImpossible: `Aus diesen Zahlen entsteht keine ${K_O_RUNDE}.`,
      /**
       * Under the season's start once a match of the season has taken place, which holds it: a match has taken place
       * once it has a result, a recorded no-show or abandonment, or one side's goals
       * (`fl_backend/app/api/teams/services.py :: has_taken_place`).
       */
      startFixed: "Steht fest, seit ein Spiel stattgefunden hat",
    },

    spiel: {
      /** The editor of a match whose two teams are not both known yet, named by its number. */
      number: (nr: number) => `Spiel ${formatNumber(nr)}`,
      ansetzung: "Ansetzung",
      ergebnis: "Ergebnis",
      /** The players credited with a result's goals, as a field's message names what it must not hold. */
      torschuetzen: "Torschützen",
      notiz: "Notiz",
      datum: SPIEL_FACT.datum,
      uhrzeit: SPIEL_FACT.uhrzeit,
      sonderereignis: "Sonderereignis",
      /** The Sonderereignis' first entry: nothing beyond the match being played. */
      none: "Keines",
      ausgefallen: SONDEREREIGNIS.ausgefallen,
      nichtantretenTeam1: "Nichtantreten Team 1",
      nichtantretenTeam2: "Nichtantreten Team 2",
      /** The fixture's two sides, by the names the Sonderereignis' entries give them. */
      team1: "Team 1",
      team2: "Team 2",
      abgebrochen: SONDEREREIGNIS.abgebrochen,
      annulliert: SONDEREREIGNIS.annulliert,
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
