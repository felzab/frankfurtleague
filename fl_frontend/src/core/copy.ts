import {
  formatDatum,
  formatDatumLong,
  formatDatumWithWeekday,
  formatErgebnis,
  formatInstant,
  formatList,
  formatNumber,
  formatOrdinal,
  formatPeriod,
  formatUhrzeit,
} from "./format";
import { rollenText } from "./teamVocabulary";

import type { CalendarDay, Pair, Uhrzeit } from "./format";
import type { FLKontaktRolle, FLSpielerStufe } from "./generated/client/types";

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
  setUp: "Einrichten",
  rename: "Umbenennen",
  set: "Setzen",
  enter: "Eintragen",
  edit: "Bearbeiten",
  swap: "Tauschen",
  replace: "Ersetzen",
  recreate: "Neu anlegen",
  activate: "Umstellen",
  /** A venue's and a referee's retiring, and its undoing, each the danger box's act. */
  retire: "Stilllegen",
  reactivate: "Reaktivieren",
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
// A match or a matchday not dated yet, as a match row and a matchday's line say it.
const DATE_OPEN = "Termin offen";
// The mark beside a score a shoot-out decided.
const AFTER_ELFMETERSCHIESSEN = "n. E.";
const SONDEREREIGNIS = { ausgefallen: "Ausgefallen", abgebrochen: "Abgebrochen", annulliert: "Annulliert" } as const;
const SIGN_IN = "Anmeldung";
const SIGN_IN_WITH_PASSKEY = "Mit Passkey anmelden";
const SET_UP_PASSKEY = { title: "Passkey einrichten", button: "Jetzt einrichten" } as const;
// The glossary's nouns, each one entry of `shared` and read under the page keys and the match facts naming them.
const SPIELER = "Spieler";
const SCHIEDSRICHTER = "Schiedsrichter";
const KADER = "Kader";
// The privacy notice's title, which the deletion box's sentence names as the place listing what outlives an erasure.
const PRIVACY_NOTICE = "Datenschutz";
// A season's name, `shared`'s entry, which the application page's title names its season by.
const saisonName = (id: string) => `Saison ${id}`;
// A team's season, Deine Einträge's fact, which the deletion list's label for a registration names it by.
const teamSeason = (team: Words, saison: Copy) => `${textOf(team)}, ${saison}`;

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

    /** The five toast titles; a toast carries no body. */
    toast: {
      // Redesign: `copied` and `signedOut` are read once copying and signing out each toast through the kit.
      copied: "Kopiert",
      linkSent: "Link gesendet",
      signedOut: "Abgemeldet",
      /** Every other device's session ended, this one's kept. */
      othersSignedOut: "Alle abgemeldet",
      failure: UNEXPECTED,
    },

    /** The spinner's accessible name; a busy button keeps its own label. */
    loading: "Lädt",

    /** The plural is the list's own title entry. */
    empty: {
      search: (plural: Copy) => `Keine ${plural} für diese Suche.`,
      filter: (plural: Copy) => `Keine ${plural} für diese Filter.`,
      none: (plural: Copy) => `Noch keine ${plural}.`,
      /** An Übersicht card holding no open work: nothing is waiting, where `none` would say something is still to come. */
      nothingOpen: "Nichts offen.",
    },

    /** „Passkey löschen?“: a confirmation asks with the verb its button carries. */
    question: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}?`,
    back: "Zurück",
    /** The name of the icon button closing a pop-up that asks nothing, such as the match pop-up. */
    close: "Schließen",

    /** The end states of a page a mail opens; each page names its own sentence for the done state. */
    end: {
      doneOn: (done: Copy, day: CalendarDay) => `${done} am ${formatDatumLong(day)}.`,
      linkInvalid: "Dieser Link gilt nicht mehr.",
      toHome: "Zur Startseite",
      toAccount: "Zum Konto",
      /** A signed-in frame's way home, its role's Übersicht. */
      toOverview: "Zur Übersicht",
      toSaisons: "Zu den Saisons",
    },

    /** The match pop-up's way to the match's own page. */
    toSpiel: "Zum Spiel",
    /** A club's plaque popover's way to the club's own page. */
    toTeam: "Zum Team",
    /** A fact nobody has entered, where a sentence names it in words rather than a glyph: a match mail's ground. */
    notProvided: "Nicht hinterlegt",
    /** A value not there yet, in a tile, a table cell or a score's place: a glyph, not a word. */
    noValue: "–",
    /** Between a pairing's two sides where no score stands between them, as a fixture's pairing reads: a glyph, not a word. */
    versus: "–",
    overview: "Übersicht",
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
    afterElfmeterschiessen: AFTER_ELFMETERSCHIESSEN,
    /**
     * The two routes out of a season, each in its three wordings: `label` names the record, `state` the club's
     * resulting state, `kuerzel` the badge. `AUSTRITT_OPTIONS` serves them to every surface, so no two can name
     * one record differently.
     */
    austritt: {
      disqualifikation: { label: "Disqualifikation", state: "Disqualifiziert", kuerzel: "DQ" },
      rueckzug: { label: "Rückzug", state: "Zurückgezogen", kuerzel: "RZ" },
    },
    /** The head of a club's exit note, „Disqualifiziert seit 14.03.2026“: its route's `state` and the day it took effect. */
    austrittSince: (state: Copy, day: CalendarDay) => `${state} seit ${formatDatum(day)}`,
    startelf: "Startelf",
    bank: "Bank",
    /** A club's goals, a match's and a season's: a column head, a tile, a field's message. */
    tore: "Tore",
    /** A record's name: a box's label, a list's column head. */
    name: "Name",
    /** The glossary's nouns for a pupil, a referee and a squad: a page's title, a Funktion, an entry's box. */
    spieler: SPIELER,
    schiedsrichter: SCHIEDSRICHTER,
    kader: KADER,

    /**
     * The kit's season blocks that a client component draws: a table's rows reach the list's client table. The
     * rest, which only the server draws, stand in `SERVER_COPY.season`.
     */
    season: {
      /** A group by its letter, „Gruppe A“: the Tabelle's cards, a club's group, the season editor's pickers. */
      gruppe: (gruppe: string) => `Gruppe ${gruppe}`,
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
    saisonName,

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
    privacyNotice: PRIVACY_NOTICE,
    accountSignIn: SIGN_IN,
    accountSecurity: "Sicherheit",
    accountAppearance: "Darstellung",
    accountEntries: "Deine Einträge",
    adminSaisons: "Saisons",
    spiele: "Spiele",
    adminSpielorte: "Spielorte",
    adminSchiedsrichter: SCHIEDSRICHTER,
    adminBewerbungen: "Bewerbungen",
    adminSpieler: SPIELER,
    registrierungen: "Registrierungen",
    teamKader: KADER,
    adminAdministrators: "Administratoren",
    adminBanList: "Sperrliste",
    adminErasures: "Löschungen",
    adminAddressChanges: "Adressänderungen",
    adminActionLog: "Protokoll",
    addressChangeConfirmation: "Änderung der E-Mail-Adresse",
    /** A contact person's and a referee's confirmation of their own entry. */
    entryConfirmation: "Eintrag bestätigen",
    spielbestaetigung: "Spieltermin bestätigen",
    registrierungConfirmation: "Registrierung bestätigen",
    accountErasure: "Konto löschen",
    registrierung: "Registrierung",
    bewerbung: (saison: string) => `Bewerbung ${saisonName(saison)}`,
  },

  // Redesign: goes with its last importer.
  /** The old application form's words. */
  bewerbung: {
    /** The one switch acknowledging, for all three seats, that their people know of their entry. */
    kenntnisnahme: "Ja, die Angaben stimmen, und die drei Personen wissen von ihrem Eintrag.",
  },

  /** The Spielplan, and a match's page, which opens as the pop-up over it. */
  spielplan: {
    /** The matchday tabs' name, and the plural an empty Spielplan names. */
    spieltage: "Spieltage",
    /** When a match is played, as its row shows it; until it is dated, what is still to settle. */
    when: (day: CalendarDay | null, time: Uhrzeit | null) =>
      day === null ? DATE_OPEN : time === null ? formatDatumWithWeekday(day) : `${formatDatumWithWeekday(day)} · ${formatUhrzeit(time)}`,

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
        nichtAngetreten: (opponent: Words) => `Das Spiel wird für ${textOf(opponent)} gewertet.`,
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
      schiedsrichter: SCHIEDSRICHTER,
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
    /** The mark beside an editor's part still waiting on a value or an answer. */
    open: "Offen",

    /** A page a mail opened whose link no longer holds, above the catalogue's sentence for it. */
    linkInvalid: "Link nicht mehr gültig",
  },

  /** Signing in: the address and its code, the passkey, and the answers either can meet. */
  signIn: {
    /** `/signin`'s tab title, and its card's heading, signed out and signed in: the act its button names. */
    title: VERB.signIn,
    passkeyTitle: "Passkey",

    address: "E-Mail-Adresse",
    sendCode: "Code senden",
    or: "oder",
    withPasskey: SIGN_IN_WITH_PASSKEY,

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
      setUp: { ...SET_UP_PASSKEY, sentence: "Die Verwaltung ist erst mit einem Passkey erreichbar." },
      signIn: { title: SIGN_IN_WITH_PASSKEY, sentence: "Melde dich mit dem Passkey an, den du eingerichtet hast.", button: "Jetzt anmelden" },
      offer: { ...SET_UP_PASSKEY, sentence: "Mit einem Passkey meldest du dich künftig sicher ohne Code an." },
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

  /** Konto, the account's own pages, each box's title over its one sentence of description. */
  account: {
    address: {
      description: "Mit dieser Adresse meldest du dich an.",
      /** The address on file, shown over the field for its replacement; the pending change's sentence calls it the same. */
      current: "Bisherige E-Mail-Adresse",
      new: "Neue E-Mail-Adresse",
      /** The act's noun, „Link senden“. */
      link: "Link",
      /** The pending change's noun, „Änderung zurückziehen“, the glossary's screen word. */
      change: "Änderung",
      /**
       * The pending change, in the two parts around its new address, which the box sets semibold between them: waiting
       * on the address on file's link, which confirms first, or on the new address's own, by the step's deadline.
       */
      pending: {
        before: "Die neue Adresse",
        previous: (until: string | null) =>
          until === null
            ? "wartet auf die Bestätigung deiner bisherigen Adresse."
            : `wartet bis ${formatInstant(until)} auf die Bestätigung deiner bisherigen Adresse.`,
        new: (until: string | null) =>
          until === null ? "wartet auf ihre Bestätigung." : `wartet bis ${formatInstant(until)} auf ihre Bestätigung.`,
      },
      /** The step the change waits on lapsed; the hourly pass ends it. */
      lapsed: "Die Änderung ist abgelaufen.",
      /** A grant's move waits on another administrator, who approves it apart from both links. */
      grantNote: "Eine andere Person aus der Verwaltung muss die Änderung genehmigen.",
      unchanged: "Das ist schon deine E-Mail-Adresse.",
      noApprover: "Gerade kann niemand aus der Verwaltung die Änderung genehmigen.",
    },
    erasure: {
      // What outlives an erasure is the privacy notice's to list. Konto's deletion box and the deletion mail read this
      // sentence; the done page states it as done, `SERVER_COPY.accountErasure.doneSentence`.
      description: `Dein Konto und deine Angaben werden gelöscht, bis auf das, was unter „${PRIVACY_NOTICE}“ steht.`,
      consequence: "Den Link zum Löschen bekommst du per E-Mail.",
    },
    passkeys: {
      title: "Passkeys",
      description: "Mit einem Passkey meldest du dich ohne Code an.",
      /** A row's line under its name, in a list's date form: when it was set up, and when it last signed in where it has. */
      dates: (created: Date, lastUsed: Date | null) =>
        lastUsed === null
          ? `Eingerichtet am ${formatDatum(created)}`
          : `Eingerichtet am ${formatDatum(created)} · Zuletzt verwendet am ${formatDatum(lastUsed)}`,
      /**
       * The deletion's consequence, worded after the passkey touch, whose sign-in the session then is: the devices
       * the passkey signed in, this one among them where the touch was made with it.
       */
      endsDevices: "Geräte, die damit angemeldet sind, werden abgemeldet.",
      endsThisDevice: "Auch dieses Gerät wird abgemeldet.",
      /** An administrator's last passkey, their only way into the administration. */
      lastKept: "Der letzte Passkey lässt sich nicht löschen.",
      limit: (count: number) => `Mehr als ${formatNumber(count)} Passkeys sind nicht möglich.`,
      /** A first passkey set up past the sign-in library's `freshAge`. */
      signInTooOld: "Deine Anmeldung liegt zu lange zurück.",
      /** A further passkey set up on an authenticator holding one of the person's already. */
      alreadyOnDevice: "Auf diesem Gerät hast du schon einen Passkey.",
    },
    devices: {
      title: "Geräte",
      description: (count: number) =>
        count === 1 ? "Du bist auf 1 Gerät angemeldet." : `Du bist auf ${formatNumber(count)} Geräten angemeldet.`,
      /** The act's noun, „Alle anderen abmelden“. */
      allOthers: "Alle anderen",
      consequence: "Nur dieses Gerät bleibt angemeldet.",
    },
    appearance: {
      description: "Hell, dunkel oder wie dein Gerät.",
    },
    /**
     * „Funktion wechseln“'s entries: a team by its name, with this line under it naming the season and the seats held
     * there in the seats' order; a pupil's and a referee's by `shared`'s nouns, the administration's by its role.
     */
    role: {
      seats: (saison: Copy, rollen: readonly FLKontaktRolle[]) => `${saison} · ${rollenText(rollen)}`,
    },
    /**
     * Each record an address holds, as Deine Einträge boxes it: titled by what the record is, a team's seats by the
     * team's name, the rest by `shared`'s noun or the page's, and described by the person's part in it.
     */
    entries: {
      /** Deine Einträge's empty state, „Noch keine Einträge.“ */
      plural: "Einträge",
      /** Each entry box's one sentence, by the kind of record it holds, naming the role the person holds in it. */
      description: {
        spieler: "Dein Eintrag als Spielerin oder Spieler im Kader und was davon öffentlich ist.",
        registrierung: "Deine Registrierung als Spielerin oder Spieler und was davon öffentlich ist.",
        schiedsrichter: "Dein Eintrag als Schiedsrichterin oder Schiedsrichter und was davon öffentlich ist.",
        /** A seat on a team's season and a seat in an application alike, by the seats held, in the seats' order. */
        seat: (rollen: readonly FLKontaktRolle[]) => `Dein Eintrag als ${rollenText(rollen)} und wie wir dich erreichen.`,
      },
      /** The facts an entry box shows of its record. */
      facts: { birthday: "Geburtsdatum", phone: "Telefon", school: "Schule", team: "Team" },
      /** Under the media box of a person short of its floor, who may not give that choice yet. */
      mediaFrom: (age: number) => `Erst ab ${formatNumber(age)} Jahren`,
      /** A seat's or a registration's team season: „Birkenschule, Saison 2027“. */
      teamSeason,
      /**
       * The labels the deletion's list names an address's records by (`fl_frontend/src/app/(classic)/erasure/page.tsx`),
       * each the person's part in the record: one row per label, holding the records it names.
       */
      spieler: "Als Spielerin oder Spieler",
      schiedsrichter: "Als Schiedsrichterin oder Schiedsrichter",
      /** The seats a contact person holds on one row, as one phrase in the seats' order: „Als Ansprechperson und Trainerin oder Trainer“. */
      seats: (rollen: readonly FLKontaktRolle[]) => `Als ${rollenText(rollen)}`,
      /** An application not yet decided, by the season it applies for. */
      bewerbung: (saison: Copy) => `Bewerbung für die ${saison}`,
      /** A pupil's registration, by its team where the team still stands. */
      registrierung: (team: Words | null, saison: Copy) =>
        team === null ? `Registrierung für die ${saison}` : `Registrierung für ${teamSeason(team, saison)}`,
      /** One label's records, where an address holds several under it. */
      several: (records: readonly Words[]) => formatList(records.map(textOf)),
    },
  },

  /** The administration's own words: its frame, the Spielorte list, the match editor and the season editor. */
  admin: {
    /** The role an administrator acts in, the account row's second line. */
    role: "Verwaltung",
    /** The rail's headings over its groups; the Übersicht stands above them with none. */
    group: {
      saisonsAndSpiele: "Saisons und Spiele",
      schulenAndSpieler: "Schulen und Spieler",
      accessAndPrivacy: "Zugang und Datenschutz",
    },

    /** The Übersicht's acts done in a dialog from a card's row: the objects they name, and the Zusage's inputs. */
    overview: {
      termin: "Termin",
      zusage: "Zusage",
      vorschlag: "Vorschlag",
      /** Which of the row's open parties agreed: one segment each. */
      zusageFrom: "Zusage von",
      /** How the party's agreement reached the league, which the confirmation stores. */
      reason: "Begründung",
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
      /** The danger box's two consequences, under the act's name and in its question alike. */
      retireConsequence: "Der Spielort steht für neue Spiele nicht mehr zur Auswahl.",
      reactivateConsequence: "Der Spielort steht wieder zur Auswahl.",
      /** The venue list's last entry, which opens the create dialog with the name typed so far. */
      createEntry: "Spielort anlegen",
      /** One line of a venue's address: its street and number. */
      strasseWithHausnummer: (strasse: string, hausnummer: string) => `${strasse} ${hausnummer}`,
      /** A whole address on one line, „Schulweg 8, 60317 Frankfurt am Main“, after its street line. */
      addressLine: (street: Copy, plz: string, stadt: string) => `${street}, ${plz} ${stadt}`,
    },

    /** A referee's fee for a match: the referee's own default, and a match's booking. */
    honorar: "Honorar",

    schiedsrichter: {
      search: "Schiedsrichter suchen",
      /** The chip after the name of a referee who has not confirmed their entry. */
      unconfirmed: "Unbestätigt",
      /** The editor's sections beyond the record's own name: how to reach the person, and what became of their link. */
      kontaktdaten: "Kontaktdaten",
      bestaetigung: "Bestätigung",
      /** The fact saying where the referee's confirmation stands, one of the four lines below. */
      state: "Stand",
      confirmedOn: (day: CalendarDay) => `Bestätigt am ${formatDatum(day)}`,
      openUntil: (day: CalendarDay) => `Offen bis ${formatDatum(day)}`,
      expiredOn: (day: CalendarDay) => `Abgelaufen am ${formatDatum(day)}`,
      objectedOn: (day: CalendarDay) => `Widersprochen am ${formatDatum(day)}`,
      /** The create dialog's, and a corrected address's while the person has not confirmed: a link goes to the address. */
      linkGoes: "An diese Adresse geht ein Link zur Bestätigung.",
      /** The example a phone box's message names, from the Federal Network Agency's range for media use. */
      telefonExample: "069 90009123",
      retireConsequence: "Die Person steht für neue Spiele nicht mehr zur Auswahl.",
      reactivateConsequence: "Die Person steht wieder zur Auswahl.",
      /** A retired referee who has not answered, whom the reactivation asks again. */
      reactivateWithLink: "Die Person steht wieder zur Auswahl und bekommt einen neuen Link.",
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

      /** The span a season runs from its start to its end: the list's column and the editor's first box. */
      zeitraum: "Zeitraum",
      /** A new season's id, which is the year it is played in. */
      jahr: "Jahr",
      /** A span's two days, the season's and each window's alike. */
      beginn: "Beginn",
      ende: "Ende",

      /** The editor's boxes, in the order of a season's life: its dates and rules, then what happens in it. */
      regeln: "Regeln",
      forfeit: "Wertung bei Nichtantreten",
      bewerbungsfenster: "Bewerbungsfenster",
      registrierungsfenster: "Registrierungsfenster",
      gruppentausch: "Gruppentausch",
      ersatz: "Ersatz",
      registrierungslinks: "Registrierungslinks",
      umstellung: "Umstellung",

      winPoints: "Punkte pro Sieg",
      drawPoints: "Punkte pro Unentschieden",
      tiebreak: "Bei Punktgleichheit",
      tordifferenz: "Tordifferenz",
      direkterVergleich: "Direkter Vergleich",
      gruppen: "Gruppen",
      teamsPerGruppe: "Teams pro Gruppe",
      qualifiers: "Qualifikanten pro Gruppe",
      forfeitWinner: "Tore des Siegers",
      forfeitLoser: "Tore des Verlierers",
      maxKader: "Maximale Kadergröße",
      stufen: "Stufen",
      /** Each school level by its short name, as a squad row and the season's choice of them print it. */
      stufe: { E1: "E1", E2: "E2", Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4" } satisfies Record<FLSpielerStufe, string>,
      /** The fixture list these counts would draw is longer than one read lists, which every season page reads it in. */
      tooManySpiele: "Aus diesen Zahlen entstehen zu viele Spiele.",
      /** Under a box's title once the season's start has passed, which fixes its scoring, its seeding and its clubs. */
      lockedSinceStart: "Seit Saisonbeginn gesperrt",
      /** Under the rules' title while a Spielplan stands: the counts it was drawn from move only with a new draw. */
      lockedByDraw: "Gesperrt, solange ein Spielplan steht",
      /** The registration link paused: the window stands, and a link opens nothing until the box is cleared. */
      registrierungPaused: "Registrierung pausiert",

      /** When the Spielplan was drawn, beside its counts. */
      drawnOn: "Angelegt",
      noDraw: "Noch kein Spielplan.",
      recreateConsequence: "Alle Spieltage und Spiele dieser Saison werden gelöscht und neu angelegt.",
      deleteConsequence: "Alle Spieltage und Spiele dieser Saison werden gelöscht.",

      /** The group swap's two clubs; the swap exchanges their groups. */
      swapFirst: "Erstes Team",
      swapSecond: "Zweites Team",
      /** A club or a pair a swap or a replacement can no longer move: one of its matches has taken place. */
      tookPlace: "Ein Spiel hat stattgefunden",
      /** The replacement's two clubs: the one leaving the season, and the one taking over its row. */
      outgoing: "Ausscheidendes Team",
      incoming: "Nachrückendes Team",
      /** What the replacement does: the incoming club takes the outgoing one's group and every match of it. */
      replaceConsequence: (incoming: Words, outgoing: Words, gruppe: string) =>
        `${textOf(incoming)} übernimmt Gruppe ${gruppe} und alle Spiele von ${textOf(outgoing)}.`,

      /** Why the draw cannot be redrawn or removed now: reports stand, the season went live, or a match holds an entry. */
      reportsHold: "Spielberichte liegen vor",
      lockedSinceActivation: "Seit der Umstellung gesperrt",
      entriesHold: "Spiele haben schon Einträge",

      /** Each team's registration link as its row states it, by what the press would do with it. */
      linkSentOn: (day: CalendarDay) => `Gesendet am ${formatDatum(day)}`,
      linkNotSent: "Nicht gesendet",
      noLinkYet: "Noch kein Link",
      noConfirmedAddress: "Keine bestätigte Adresse",
      addressBarred: "Adresse auf der Sperrliste",
      /** The registration links' done line, the rows saying the rest. */
      sentTo: (count: number) => (count === 1 ? "An 1 Team gesendet" : `An ${formatNumber(count)} Teams gesendet`),
      /** The registration links' send: how many teams it mails, and whether a link one of them holds stops opening. */
      dispatchConsequence: (count: number, replacing: boolean) => {
        if (!replacing)
          return count === 1 ? "1 Team bekommt seinen Link per E-Mail." : `${formatNumber(count)} Teams bekommen ihren Link per E-Mail.`;
        return count === 1
          ? "1 Team bekommt einen neuen Link, und sein bisheriger gilt nicht mehr."
          : `${formatNumber(count)} Teams bekommen einen neuen Link, und ihr bisheriger gilt nicht mehr.`;
      },

      /** The activation: the season the site shows, and its subject, „Auf Saison 2027 umstellen?“. */
      isCurrent: "Die Website zeigt diese Saison.",
      onto: (saison: string) => `Auf ${saisonName(saison)}`,
      activateConsequence: (saison: string) => `Die Website zeigt ab sofort ${saisonName(saison)}.`,
      /** Why the activation cannot run yet: the season the site shows owes results, or this one's matchdays owe dates. */
      unfinished: "Die bisherige Saison hat noch Spiele ohne Ergebnis.",
      undated: "Diese Saison hat noch Spieltage ohne Datum.",
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

      /** The Spiele list: a match row's two facts' heads, its pairing's head, and the chip a match not yet confirmed carries. */
      termin: "Termin",
      begegnung: "Begegnung",
      provisional: "Vorläufig",
      /** A row's result: the goals, and after a shoot-out each side's goals and shoot-out goals added, marked „n. E.“. */
      score: (tore: Pair, elfmeterschiessen: Pair | null) =>
        elfmeterschiessen === null ? formatErgebnis(tore) : `${formatErgebnis(tore, elfmeterschiessen)} ${AFTER_ELFMETERSCHIESSEN}`,
      /** A matchday's dates over its matches, until it is dated what is still to settle. */
      span: (beginn: CalendarDay | null, ende: CalendarDay | null) =>
        beginn === null || ende === null ? DATE_OPEN : formatPeriod(beginn, ende),
      /** The matchday dialog's two dates. */
      beginn: "Beginn",
      ende: "Ende",

      /** The match editor's sections beyond the three it shares with the old pages: a knockout match's clubs, the report and the answers. */
      spielberichtUndBestaetigungen: "Spielbericht und Bestätigungen",
      spielbericht: "Spielbericht",
      bestaetigungen: "Bestätigungen",
      /** The Vorschau under the editor's title: the fields changed and not yet saved, each by its own label. */
      changed: (labels: readonly Copy[]) => formatList(labels),
      /** A club picked by hand over the side's source, which the side no longer follows once saved. */
      replacesQuelle: (quelle: Copy) => `Ersetzt ${quelle}`,
      /** Why a club cannot take a side: it stands on another match of the matchday, or has left the season. */
      onSpieltag: "Spielt schon an diesem Spieltag",
      departed: "Aus der Saison ausgeschieden",
      /** The referee's fee for the match, which the glossary's `payment` names on screen. */
      honorar: "Honorar",
      /** A referee who has not confirmed their entry, whom no match can be booked onto yet. */
      unconfirmed: "Noch nicht bestätigt",
      elfmeterschiessen: "Elfmeterschießen",
      /** Level knockout goals saved without a shoot-out leave the match undecided, and the bracket after it. */
      shootOutMissing: "Ohne Elfmeterschießen wartet der K.-o.-Baum.",
      /** An event after which the match carries no result, chosen over a stored one. */
      resultDropped: (score: Copy) => `Ergebnis ${score} wird verworfen`,
      /** The referee's proposal, which „Übernehmen“ carries into the fields: „Laut Spielbericht 3:1“. */
      fromReport: (result: Words) => `Laut Spielbericht ${textOf(result)}`,
      /** The report's goals as rows: what happened, the minute, and the score it made. */
      event: "Ereignis",
      minute: "Minute",
      /** The answers as rows: whose, their answer and what a declining club proposed. */
      party: "Partei",
      answer: "Antwort",
      proposal: "Vorschlag",
      reason: "Grund",
      zugesagt: "Zugesagt",
      /** A club's decline, and a referee's, as the glossary's `Absage` names the second. */
      abgelehnt: "Abgelehnt",
      abgesagt: "Abgesagt",
      answerBy: (day: CalendarDay) => `Antwort bis ${formatDatum(day)}`,
      enteredByLeague: "Von der Verwaltung eingetragen",
      notAsked: "Noch nicht angefragt",
      /** A save voiding later matches' results, which it asks before. */
      voids: (spiele: readonly number[]) =>
        spiele.length === 1
          ? `Das Ergebnis von Spiel ${formatNumber(spiele[0] ?? 0)} wird gelöscht.`
          : `Die Ergebnisse von Spiel ${formatList(spiele.map(formatNumber))} werden gelöscht.`,
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
