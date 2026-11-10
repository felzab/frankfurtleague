import {
  formatDate,
  formatDateLong,
  formatDateWithWeekday,
  formatErgebnis,
  formatInstant,
  formatInstantShort,
  formatList,
  formatNumber,
  formatOrdinal,
  formatPeriod,
  formatTime,
} from "./format";
import { KONTAKT_ROLLE_LONG_FORM, rollenText } from "./teamVocabulary";

import type { CalendarDay, Pair, TimeOfDay } from "./format";
import type {
  FLAction,
  FLActionLogPageSize,
  FLAddressChangeWaitsOn,
  FLCardColour,
  FLKontaktRolle,
  FLSchulform,
  FLSpielerRolle,
  FLSpielerStufe,
} from "./generated/client/types";

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
  accept: "Annehmen",
  /** A team's own admission of a registered pupil, the glossary's `aufnehmen`, where `accept` is the league's of a school. */
  admit: "Aufnehmen",
  /** A club's or a referee's agreement to a fixture's date, the glossary's `Zusage`, whose other answer is `decline`. */
  agree: "Zusagen",
  decline: "Ablehnen",
  oppose: "Widersprechen",
  adopt: "Übernehmen",
  discard: "Verwerfen",
  signIn: "Anmelden",
  signOut: "Abmelden",
  setUp: "Einrichten",
  rename: "Umbenennen",
  set: "Setzen",
  enter: "Eintragen",
  /** A squad's player taken into a match's line-up. */
  lineUp: "Aufstellen",
  edit: "Bearbeiten",
  swap: "Tauschen",
  replace: "Ersetzen",
  handOver: "Übergeben",
  recreate: "Neu anlegen",
  activate: "Umstellen",
  /** A venue's and a referee's retiring, and its undoing, each the danger box's act. */
  retire: "Stilllegen",
  reactivate: "Reaktivieren",
  /** The bulk accept's two ways on from a card. */
  next: "Weiter",
  skip: "Überspringen",
} as const;

/** The closed set of button verbs: a button names its act with one of these. */
export type Verb = keyof typeof VERB;

const infinitive = (verb: Verb): string => `${VERB[verb].charAt(0).toLowerCase()}${VERB[verb].slice(1)}`;

// One line for every failure no reason names, the same in a toast and in a status line.
const UNEXPECTED = "Etwas ist schiefgelaufen";

// The glossary's one spelling, which the season editor's sentence about it takes too.
const K_O_RUNDE = "K.-o.-Runde";
/** A group by its letter, „Gruppe A“, which the season's blocks and the replacement's sentence both say. */
const GRUPPE = (gruppe: string) => `Gruppe ${gruppe}`;

// Words two areas of this one object say alike, each written once and read under both keys: a match's facts and
// its events as a visitor reads them and as the editor's fields name them, and the sign-in's acts and pages.
const SPIEL_FACT = { date: "Datum", time: "Uhrzeit" } as const;
// A match or a matchday not dated yet, as a match row and a matchday's line say it.
const DATE_OPEN = "Termin offen";
// The mark beside a score a shoot-out decided.
const AFTER_ELFMETERSCHIESSEN = "n. E.";
// A party's agreement to a fixture's date: its chip, and the toast as the agreed row leaves its list.
const ZUGESAGT = "Zugesagt";
const SONDEREREIGNIS = { ausgefallen: "Ausgefallen", abgebrochen: "Abgebrochen", annulliert: "Annulliert" } as const;
// Two clubs named by their place in a pair: a fixture's two sides, and the group swap's two clubs.
const TEAM_PAIR = { team1: "Team 1", team2: "Team 2" } as const;
const SIGN_IN = "Anmeldung";
const SIGN_IN_WITH_PASSKEY = "Mit Passkey anmelden";
const SET_UP_PASSKEY = { title: "Passkey einrichten", button: "Jetzt einrichten" } as const;
// What a passkey does for a person, the sign-in's offer and Sicherheit's box alike.
const PASSKEY_WITHOUT_CODE = "Mit einem Passkey meldest du dich ohne Code an.";
// An administrator's card, whether it sets the passkey up or signs in with one held.
const PASSKEY_REQUIRED = "Die Verwaltung ist erst mit einem Passkey erreichbar.";
// The glossary's nouns, each one entry of `shared` and read under the page keys and the match facts naming them.
const SPIELER = "Spieler";
const SCHIEDSRICHTER = "Schiedsrichter";
const KADER = "Kader";
// The privacy notice's title, which the deletion box's sentence names as the place listing what outlives an erasure.
const PRIVACY_NOTICE = "Datenschutz";
// The danger box over a record's retiring: a venue's, a referee's and a club's alike.
const RETIREMENT = "Stilllegung";
// A season's name, `shared`'s entry, which the application page's title names its season by.
const saisonName = (id: string) => `Saison ${id}`;
// A team's season, Deine Einträge's fact, which the deletion list's label for a registration names it by.
const teamSeason = (team: Words, saison: Copy) => `${textOf(team)}, ${saison}`;
// A line-up's starters of the most that may start, alone in the save bar and after the count of everyone it names.
const startelfCount = (count: number, max: number) => `Startelf ${formatNumber(count)} von ${formatNumber(max)}`;
// The owner tier's one word: its chip, its acts and every sentence naming it, the server's among them, read this line.
const OWNER_TIER = "Leitung";
// The plurals a page's title and the action log's count of a pass say alike.
const BEWERBUNGEN = "Bewerbungen";
const REGISTRIERUNGEN = "Registrierungen";
const KONTAKTPERSONEN = "Kontaktpersonen";
const CONFIRMATIONS = "Bestätigungen";
const ADDRESS_CHANGES = "Adressänderungen";
const BANS = "Sperren";
// The moment a waiting change takes effect, a fact's label and a row's line alike.
const EFFECTIVE_FROM = "Gilt ab";
// A link's last moment, a fact's label and a row's line alike.
const VALID_UNTIL = "Gültig bis";
// A person's own deletion: the action log's word for it, and the done page's.
const ACCOUNT_ERASED = "Konto gelöscht";
// One word for every retention pass, its noun saying what it took.
const DELETED_BY_PASS = "Nach Frist gelöscht";

/**
 * A wait a sentence states, in the unit its bound is published in. Each figure is a literal, so a bound that moves fails
 * the type check here rather than printing a wrong plural.
 */
export type Wait = { readonly hours: 24 } | { readonly days: 7 };

/**
 * A wait's two German forms, digits always: `span` after „gilt“, and `after` taking the dative. Exported for the
 * server's own catalogue, `serverCopy.ts`, alone.
 */
export const waitWords = (wait: Wait) =>
  "hours" in wait
    ? { span: `${formatNumber(wait.hours)} Stunden`, after: `nach ${formatNumber(wait.hours)} Stunden` }
    : { span: `${formatNumber(wait.days)} Tage`, after: `nach ${formatNumber(wait.days)} Tagen` };

export const COPY = catalogue({
  /** What every area draws from; an area adds a key of its own only for a string this lacks. */
  shared: {
    verb: VERB,
    /** „Team anlegen“: a button whose verb needs its object. */
    withObject: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}`,

    /** The units a field's figure is counted in, set after the field. */
    unit: {
      euro: "€",
      minute: "Min.",
    },

    /** A field's one message line: what is expected, never the field's name. */
    field: {
      required: "Pflichtfeld",
      maxChars: (count: number) => `Höchstens ${formatNumber(count)} Zeichen`,
      minChars: (count: number) => `Mindestens ${formatNumber(count)} Zeichen`,
      format: (example: Copy) => `Format: ${example}`,
      // A reserved domain, so no reader takes the example for the address the league expects.
      exampleAddress: "name@example.com",
      // A name's examples, by the box: `fl_backend/app/shared/schemas/custom.py :: PERSON_NAME_PATTERN` takes letters, hyphens, apostrophes and spaces.
      exampleName: "Anna Weber",
      exampleFirstName: "Anna",
      exampleLastName: "Weber",
      // A digits field's example: figures alone, whatever the field counts.
      exampleDigits: "123",
      exampleDate: "31.12.2026",
      // Reserved as the address example's domain is.
      exampleUrl: "https://example.com",
      between: (from: number, to: number) => `Zwischen ${formatNumber(from)} und ${formatNumber(to)}`,
      // One-sided bounds of a number or of a list, the box's label saying what is counted.
      max: (count: number) => `Höchstens ${formatNumber(count)}`,
      min: (count: number) => `Mindestens ${formatNumber(count)}`,
      /** „Ohne E-Mail-Adresse“: what a text must not hold, by the catalogue's own name for it. */
      without: (thing: Copy) => `Ohne ${thing}`,
      earliest: (day: CalendarDay) => `Frühestens ${formatDate(day)}`,
      latest: (day: CalendarDay) => `Spätestens ${formatDate(day)}`,
      // A unique index's refusal: a field's message, and the words `serverCopy.ts` answers its code in.
      taken: "Schon vergeben",
    },

    /** The three lines every refusal no person causes knowingly from the screen falls back to. */
    failure: {
      unexpected: UNEXPECTED,
      stale: "Die Seite ist nicht mehr aktuell.",
      signInExpired: "Deine Anmeldung ist abgelaufen.",
      /** A press past any limit on tries, whatever was counted: the edge's rate, a code's wrong tries, an address's codes. */
      tooManyAttempts: "Zu viele Versuche.",
      /** An administrator's grant is gone or was never held: no sign-in and no retry repairs it. */
      accessGone: "Dein Zugang zur Verwaltung besteht nicht mehr.",
    },

    /** Beside the save button once the record is stored. */
    saved: "Gespeichert",
    /** The chip of a venue or a referee taken out of use, and its greyed entry where a match books one. */
    retired: "Stillgelegt",

    /**
     * The toast titles; a toast carries no body. `linkSent` labels the referee editor's fact for the day the last
     * link went too, the same words for the same event.
     */
    toast: {
      copied: "Kopiert",
      linkSent: "Link gesendet",
      /** Every other device's session ended, this one's kept. */
      othersSignedOut: "Alle abgemeldet",
      /** A row leaving its list with its act done: a fixture's date agreed, in its chip's word, and a registration admitted. */
      agreed: ZUGESAGT,
      admitted: "Aufgenommen",
      failure: UNEXPECTED,
    },

    /** The spinner's accessible name; a busy button keeps its own label. */
    loading: "Lädt",

    /** The plural is the list's own title entry where the title is a plural, else the noun the catalogue keeps for its rows. */
    empty: {
      search: (plural: Copy) => `Keine ${plural} für diese Suche.`,
      filter: (plural: Copy) => `Keine ${plural} für diese Filter.`,
      none: (plural: Copy) => `Noch keine ${plural}.`,
      /** A list that is one record named by a masculine or neuter noun, a team's „Kader“: „Noch kein Kader.“ */
      noneOne: (noun: Copy) => `Noch kein ${noun}.`,
      /** An Übersicht card holding no open work: nothing is waiting, where `none` would say something is still to come. */
      nothingOpen: "Nichts offen.",
    },

    /** „Passkey löschen?“: a confirmation asks with the verb its button carries. */
    question: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}?`,
    back: "Zurück",
    /** The name of the icon button closing a pop-up that asks nothing, such as the match pop-up. */
    close: "Schließen",

    /** The status cards' titles and ways on: a mailed page's ends, and the frames' own. */
    end: {
      /** A mailed page's link opened again, titled with what the person did and the day: „Eintrag bestätigt am 12. November 2026“. */
      doneOn: (done: Copy, day: CalendarDay) => `${done} am ${formatDateLong(day)}`,
      /** An area with no season yet, where a page shows a season's work. */
      noSaison: "Noch keine Saison",
      toHome: "Zur Startseite",
      toAccount: "Zum Konto",
      /** A signed-in frame's way home, its role's Übersicht. */
      toOverview: "Zur Übersicht",
      toSaisons: "Zu den Saisons",
      toTeams: "Zu den Teams",
    },

    /** The match pop-up's way to the match's own page. */
    toSpiel: "Zum Spiel",
    /** An accepted application's way to its team's page. */
    toTeam: "Zum Team",
    /** A fact nobody has entered, where a sentence names it in words rather than a glyph: a match mail's ground. */
    notProvided: "Nicht hinterlegt",
    /** A value not there yet, in a tile, a table cell or a score's place: a glyph, not a word. */
    noValue: "–",
    /** Between a pairing's two sides where no score stands between them, as a fixture's pairing reads: a glyph, not a word. */
    versus: "–",
    overview: "Übersicht",
    switchRole: "Funktion wechseln",
    loadMore: `Weitere ${50 satisfies FLActionLogPageSize} laden`,
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
     * resulting state, `shorthand` the badge. `AUSTRITT_OPTIONS` serves them to every surface, so no two can name
     * one record differently.
     */
    austritt: {
      disqualifikation: { label: "Disqualifikation", state: "Disqualifiziert", shorthand: "DQ" },
      rueckzug: { label: "Rückzug", state: "Zurückgezogen", shorthand: "RZ" },
    },
    /** The head of a club's exit note, „Disqualifiziert seit 14.03.2026“: its route's `state` and the day it took effect. */
    austrittSince: (state: Copy, day: CalendarDay) => `${state} seit ${formatDate(day)}`,
    startelf: "Startelf",
    bank: "Bank",
    /**
     * The boxed mark after the name of a squad's Kapitän and its Co-Kapitän, on every squad and line-up; its
     * accessible name is the role's own, `admin.spieler.rolleOption`.
     */
    rolleMark: { kapitaen: "C", co_kapitaen: "Co" } satisfies Record<FLSpielerRolle, string>,
    /** A club's goals, a match's and a season's: a column head, a tile, a field's message. */
    tore: "Tore",
    /** A record's name: a box's label, a list's column head. */
    name: "Name",
    /** A person's two names, each its own box wherever a person is entered. */
    firstName: "Vorname",
    lastName: "Nachname",
    /** A person's or a school's facts by their labels: a box, a fact in a list, a column head. */
    facts: { birthday: "Geburtsdatum", phone: "Telefon", school: "Schule", team: "Team" },
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
      gruppe: GRUPPE,
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

    /**
     * The bot check's one answer a person can act on, its click shown or its judgement against the token; a check that
     * did not load, mint or reach Cloudflare is the unexpected failure.
     */
    botCheck: "Die Bestätigung, dass du ein Mensch bist, fehlt.",
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
    /** A match's page, named by its two teams in the order the fixture lists them: every pairing written in words. */
    spiel: (team1: Words, team2: Words) => `${textOf(team1)} vs. ${textOf(team2)}`,
    about: "Über die Liga",
    contact: "Kontakt",
    sponsors: "Sponsoren",
    legalNotice: "Impressum",
    privacyNotice: PRIVACY_NOTICE,
    sitemap: "Sitemap",
    accountSignIn: SIGN_IN,
    accountSecurity: "Sicherheit",
    accountAppearance: "Darstellung",
    accountEntries: "Deine Einträge",
    adminSaisons: "Saisons",
    spiele: "Spiele",
    adminSpielorte: "Spielorte",
    adminSchiedsrichter: SCHIEDSRICHTER,
    adminBewerbungen: BEWERBUNGEN,
    adminBewerbungenBulk: "Sammel-Zusage",
    adminSpieler: SPIELER,
    registrierungen: REGISTRIERUNGEN,
    teamKader: KADER,
    adminAdministrators: "Administratoren",
    adminBanList: "Sperrliste",
    adminErasures: "Löschungen",
    adminAddressChanges: ADDRESS_CHANGES,
    adminActionLog: "Protokoll",
    addressChangeConfirmation: "Änderung der E-Mail-Adresse",
    /** A contact person's and a referee's confirmation of their own entry. */
    entryConfirmation: "Eintrag bestätigen",
    registrierungConfirmation: "Registrierung bestätigen",
    accountErasure: "Konto löschen",
    registrierung: "Registrierung",
    bewerbung: (saison: string) => `Bewerbung ${saisonName(saison)}`,
  },

  /** The public application form's own words; what the administration names alike stands in `team`. */
  bewerbung: {
    /** The object of „Bewerbung abschicken“, „Bewerbung annehmen“ and „Bewerbung ablehnen“, and the review page's first box. */
    object: "Bewerbung",
    schoolDescription: "Die Schulen, die schon mitgespielt haben",
    /** The switch under the school picker, revealing a new school's fields. */
    schoolNotListed: "Meine Schule ist nicht in der Liste",
    teamName: "Teamname",
    teamNameDescription: "Kurz, wie das Team genannt wird",
    stufengroesseDescription: "Wie viele im Abi-Jahrgang sind",
    /** Each seat confirms for one person, which a shared inbox would let one person do for two. */
    ownAddress: "Die eigene Adresse der Person",
    /** A covered seat's box, in place of its fields. */
    seatCovered: "Übernimmt die Trainerin oder der Trainer.",
    /** Under the address: the promise `docs/datenschutz.md` section 4 records the form makes. */
    addressPublic: "Steht nach der Aufnahme öffentlich auf der Teamseite",
    trikotSetDescription: "Zum Beispiel 15 rote Trikots",
    goodSpielerDescription: "Aktiv, mindestens Verbandsliga",
    wunschgegnerDescription: "Für den ersten Spieltag",
    /** The name of the combo's arrow. */
    suggestions: "Vorschläge anzeigen",
    /** The one sentence above the submit, in the two parts around the privacy notice's title, which the form sets as its link. */
    notice: { before: "Jede Kontaktperson bestätigt ihren Eintrag per E-Mail, mehr unter ", after: "." },
  },

  /** The public registration form's own words; its squad fields read the labels `admin.spieler` gives them. */
  registrierung: {
    /** The one box's title, over the pupil's own fields. */
    box: "Deine Angaben",
    /** Under the address: the confirmation link goes there, and one address signs one person in. */
    ownAddress: "Deine eigene Adresse",
    /** The one sentence above the submit, in the two parts around the privacy notice's title, as `bewerbung.notice`. */
    notice: { before: "Du bestätigst deine Registrierung per E-Mail, mehr unter ", after: "." },
  },

  /**
   * A club's fields, one word each wherever a person meets them: the public form, the acceptance, the bulk accept, the
   * review page and the team editor.
   */
  team: {
    kontakte: KONTAKTPERSONEN,
    /** Each seat's long form, where it is a box's title or a choice of its own. */
    seatName: KONTAKT_ROLLE_LONG_FORM,
    /** The object of „Sitz bearbeiten“. */
    seat: "Sitz",
    fullName: "Vollständiger Name",
    shorthand: "Kürzel",
    shorthandDescription: "Drei Buchstaben",
    /** The closed box of a known club, whose code the acceptance does not set. */
    shorthandFixed: "Vergeben, als das Team angelegt wurde",
    /** Inside `shared.field.format`: no real club's code, so no reader takes it for one. */
    shorthandExample: "ABC",
    schulform: "Schulform",
    /** The school authority's own wording, so a `G8` or a `G9` stays in the label rather than being spelled out. */
    schulformOption: {
      gymnasium_g8: "Gymnasium (G8)",
      gymnasium_g9: "Gymnasium (G9)",
      gesamtschule: "Gesamtschule",
      privatschule_g8: "Privatschule (G8)",
      privatschule_g9: "Privatschule (G9)",
      oberstufengymnasium: "Oberstufengymnasium",
    } satisfies Record<FLSchulform, string>,
    website: "Website",
    gruppe: "Gruppe",
    trikotFarbe: "Trikotfarbe",
    wunschfarbe: "Wunschfarbe",
    stufengroesse: "Größe der Stufe",
    trikotSet: "Vorhandene Trikotsätze",
    expectedKader: "Voraussichtliche Kadergröße",
    goodSpieler: "Davon im Verein",
    wunschgegner: "Wunschgegner",
    /** The select in the Trainer's box, whose two other entries are `KONTAKT_ROLLE_LONG_FORM`'s. */
    trainerAlso: {
      label: "Übernimmt zugleich",
      description: "Eine Person kann zwei Rollen haben.",
      none: "Keine weitere Rolle",
    },
  },

  /** The Spielplan, and a match's page, which opens as the pop-up over it. */
  spielplan: {
    /** The matchday tabs' name, and the plural an empty Spielplan names. */
    spieltage: "Spieltage",
    /** When a match is played, as its row shows it; until it is dated, what is still to settle. */
    when: (day: CalendarDay | null, time: TimeOfDay | null) =>
      day === null ? DATE_OPEN : time === null ? formatDateWithWeekday(day) : `${formatDateWithWeekday(day)} · ${formatTime(time)}`,

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
      /** A no-show's chip in a match row, whose struck side names the club. */
      nichtAngetretenChip: "Nicht angetreten",
      abgebrochen: SONDEREREIGNIS.abgebrochen,
      annulliert: SONDEREREIGNIS.annulliert,
      /**
       * What the event means for the result, under its name in the pop-up's callout, which the name does not
       * repeat: a match called off or struck out awards nothing, a no-show awards the side that turned up the
       * forfeit the season's rules set, which the score shows, and an abandoned match owes a result until one is
       * entered.
       */
      consequence: {
        notScored: "Das Spiel wird nicht gewertet.",
        nichtAngetreten: (opponent: Words) => `Das Spiel wird für ${textOf(opponent)} gewertet.`,
        abgebrochenScored: "Das eingetragene Ergebnis wird gewertet.",
        abgebrochenOpen: "Die Wertung steht noch nicht fest.",
      },
    },

    /** A match's facts, each by its label. */
    fact: {
      spieltag: "Spieltag",
      date: SPIEL_FACT.date,
      time: SPIEL_FACT.time,
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
    /**
     * The account's place: the rail's account row and the phone bar's avatar, and, one word signed in and out alike,
     * the frames' link to the sign-in, which a signed-in person passes on from to their area.
     */
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
    /** The footer's way to the landing's section on applying, which stands whether or not a window is open. */
    bewerbung: "Bewerbung",
    oberstufenliga: "Die Frankfurter Oberstufenliga",
    supportedBy: "Mit Unterstützung von",
    instagram: "Instagram",
    threads: "Threads",
    copyright: (year: number, brand: Copy) => `© ${String(year)} ${brand}`,

    /** An editor's changes not yet saved: the status line names their count, the discard dialog asks before they go. */
    changes: "Änderungen",
    changesPending: (count: number) => (count === 1 ? "1 Änderung" : `${formatNumber(count)} Änderungen`),
    changesLost: (count: number) => (count === 1 ? "1 Änderung geht verloren." : `${formatNumber(count)} Änderungen gehen verloren.`),
    /** In an editor's act's own line while its draft holds unsaved changes, which close every act of it. */
    draftUnsaved: "Gesperrt, solange Änderungen ungespeichert sind",
    /** The chip after an editor's title while its record is closed read-only, its season finished. */
    closed: "Abgeschlossen",
    /** A save refused for its fields: the fields say what, the status line that some are off. */
    checkFields: "Einige Felder sind nicht richtig ausgefüllt.",
    /** The mark beside an editor's part still waiting on a value or an answer. */
    open: "Offen",

    /** A page a mail opened whose link no longer holds: one title for an expired, mistyped or tampered link alike. */
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

    /** The passkey card: an administrator's two, setting one up or signing in with one held, and anyone else's offer. */
    passkey: {
      setUp: { ...SET_UP_PASSKEY, sentence: PASSKEY_REQUIRED },
      signIn: { title: SIGN_IN_WITH_PASSKEY, sentence: PASSKEY_REQUIRED, button: "Jetzt anmelden" },
      offer: { ...SET_UP_PASSKEY, sentence: PASSKEY_WITHOUT_CODE },
      later: "Später",
    },

    /**
     * The code's and the passkey's refusals, which the page words off the library's own codes
     * (`fl_frontend/src/features/auth/signInAnswers.ts`, `passkeyAnswers.ts`). A barred address and one holding
     * no record meet one sentence, so nobody can probe the ban list.
     * The typed code's own refusal is a phrase under its boxes, a wrong code and one no longer valid alike; every other
     * is a sentence on the status line.
     */
    refusal: {
      codeWrong: "Falsch oder nicht mehr gültig",
      noRecord: "Mit dieser Adresse ist keine Anmeldung möglich.",
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
        /** Both addresses have confirmed and the wait runs. */
        waiting: (moment: string) => `gilt ab ${formatInstant(moment)}.`,
      },
      /** The step the change waits on lapsed; the hourly pass ends it. */
      lapsed: "Die Änderung ist abgelaufen.",
      /** The address on file's one act, on its link's page and on its mail's button. */
      stop: "Änderung stoppen",
      /** A holder's own change, which waits whole: Konto's box and the mails to either address. */
      holderWait: (wait: Wait) => `Die neue Adresse gilt ${waitWords(wait).span}, nachdem beide Adressen sie bestätigt haben.`,
    },
    erasure: {
      // What outlives an erasure is the privacy notice's to list. Konto's deletion box and the deletion mail read this
      // sentence; the done page leads to the notice.
      description: `Dein Konto und deine Angaben werden gelöscht, bis auf das, was unter „${PRIVACY_NOTICE}“ steht.`,
      consequence: "Den Link zum Löschen bekommst du per E-Mail.",
    },
    passkeys: {
      title: "Passkeys",
      description: PASSKEY_WITHOUT_CODE,
      /** A row's line under its name, in a list's date form: when it was set up, and when it last signed in where it has. */
      dates: (created: Date, lastUsed: Date | null) =>
        lastUsed === null
          ? `Eingerichtet am ${formatDate(created)}`
          : `Eingerichtet am ${formatDate(created)} · Zuletzt verwendet am ${formatDate(lastUsed)}`,
      /**
       * The deletion's consequence, which the question words before the passkey touch: the devices the passkey signed
       * in, and this one where the page's session was made by it or it is the person's only passkey, which the touch
       * then has to be.
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
      /** Under the media box of a person short of its floor, and a seat's field description on the form, by the seat's floor. */
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

  /**
   * The areas of a team's contact seats, a pupil and a referee, under `/area`: the words a client component there may
   * read. What the administration names alike stands in `admin`, and what only a server page reads in `SERVER_COPY.area`.
   */
  area: {
    /** What a fixture's date still waits on from a club or a referee: the noun of the chip „Antwort fehlt“. */
    answer: "Antwort",

    /** A team's pages, which any of its contact seats reads. */
    team: {
      /** The account row's second line in a team's frame: the club's Kürzel and the seats the person holds there. */
      accountLine: (shorthand: Words, rollen: readonly FLKontaktRolle[]) => `${textOf(shorthand)} · ${rollenText(rollen)}`,
      /**
       * What the league decides: the decline dialog's one sentence, a proposal moving nothing until the league saves a
       * date; and the last part of an overdue date's line on the Übersicht, which takes no answer past its deadline. A
       * declined row's line ends on the team's proposal.
       */
      declineConsequence: "Über den Termin entscheidet die Liga.",
      leagueDecides: "Die Liga entscheidet",

      /** A match's line-up: the Übersicht's box, a Spiele card's chip, the line-up's own page and the match editor's link to it. */
      aufstellung: {
        /** The Übersicht's box of the coming matches whose line-up is missing. */
        plural: "Aufstellungen",
        /** One club's line-up by the club's name, „Aufstellung Ahorn“: the match editor's link to it. */
        ofTeam: (team: Words) => `Aufstellung ${textOf(team)}`,
        /** That link's line where no line-up stands, under a name that already says what is missing. */
        missing: "Fehlt",
        /** How many of a line-up's players start, of the most that may: the save bar's own line beside its count of changes. */
        startelfCount,
        /** The same after how many players the line-up names, „14 aufgestellt · Startelf 11 von 11“: that link's line where one stands. */
        counts: (picked: number, starting: number, max: number) => `${formatNumber(picked)} aufgestellt · ${startelfCount(starting, max)}`,
        /** The lower list's title: the squad's players the line-up does not name. */
        rest: "Nicht aufgestellt",
        /**
         * Why „Aufstellen“ is locked: on a nominee's row once the line-up names eleven of the squad's own players, a
         * nominee filling a shortage alone, and on every row of a fixture holding no date or no time.
         */
        nomineeLocked: "Nur, wenn weniger als 11 aufgestellt sind",
        needsSlot: "Erst mit Datum und Uhrzeit",
        /** A missing line-up's line, by the day it is due: until then, and from then on. */
        dueBy: (day: CalendarDay) => `Aufstellung bis ${formatDate(day)}`,
        overdueSince: (day: CalendarDay) => `Aufstellung seit ${formatDate(day)} überfällig`,
        /** An overdue line-up's chip: after its own page's title, and on a Spiele card, where the chip names what is overdue. */
        overdue: "Überfällig",
        overdueOnCard: "Aufstellung überfällig",
        /** Once the team's seats can change nothing more before the match: the page's chip, and its one line. */
        locked: "Gesperrt",
        lockedLine: "Änderungen trägt jetzt die Liga ein.",
      },

      /** The team's Registrierungen: its list, the admission and the decline. */
      registrierung: {
        /**
         * The page's one standing line above the list, filled or empty, in the two parts around the league's address,
         * which the page sets as its link: only the league mints and mails a team's link.
         */
        linkFromLeague: { before: "Den Registrierungslink schickt die Liga, erreichbar unter ", after: "." },
        /** Muted in the line under a row's name: the registration's address is a stored person's. */
        returning: "War schon in der Liga",
        /** That line where it holds more than one note, „War schon in der Liga · Nummer doppelt“. */
        notes: (notes: readonly Copy[]) => notes.join(" · "),
        /** Why „Aufnehmen“ is locked: the squad is at its cap, or the pupil's own link is unanswered. */
        kaderFull: "Kader voll",
        awaitsConfirmation: "Erst, wenn die Person bestätigt hat",
        /** The decline's one sentence, under its question. */
        declineConsequence: "Die Person kommt nicht in den Kader.",
        /**
         * The admission of a registration whose address is a stored person's under other details: the line under the
         * dialog's title names that person, and the two choices say whose registration it is. A contact seat is served
         * no address, so the line names the person alone.
         */
        earlierEntry: (name: Words) => `Ein früherer Eintrag nennt ${textOf(name)}.`,
        admitAs: (name: Words) => `Als ${textOf(name)} aufnehmen`,
        otherPerson: "Andere Person, ablehnen",
      },
    },

    /** A referee's pages: the Übersicht's rows and the match report. */
    schiedsrichter: {
      /** What a referee answers, the object of „Einteilung ablehnen“. */
      einteilung: "Einteilung",

      /** The match report's form; a goal's and a result's words are the match editor's and the match page's. */
      spielbericht: {
        /** The player list's first entry on a goal, for a scorer nobody can name. */
        unknown: "Unbekannt",
        /** Inside `shared.field.format` under a minute off its pattern: the played minute, and stoppage time after a plus. */
        minuteExample: "90+3",
        cards: "Karten",
        /** One card: the name of a row's colour segments, and the object of „Karte eintragen“. */
        card: "Karte",
        colour: { gelb: "Gelb", gelb_rot: "Gelb-Rot", rot: "Rot" } satisfies Record<FLCardColour, string>,
        /** The section for what no field holds, and its text area's label. */
        remarks: "Bemerkungen",
        /** One goal: the object of „Tor eintragen“ and „Tor entfernen“, and the noun its row is counted by. */
        goal: "Tor",
        /** The label over a goal's or a card's row, counting the rows from 1: „Tor 3“, „Karte 1“. */
        numbered: (noun: Copy, number: number) => `${noun} ${formatNumber(number)}`,
        /** A no-show's entry in the Sonderereignis, by the club that stayed away. */
        nichtAngetreten: (team: Words) => `${textOf(team)} nicht angetreten`,
        /** Under the goals' title where a side fields another club than the report names, whose pupils left their rows. */
        sidesChanged: "Im Spiel stehen inzwischen andere Teams.",
      },
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
      appointment: "Termin",
      zusage: "Zusage",
      vorschlag: "Vorschlag",
      /** Which of the row's open parties agreed: one segment each. */
      zusageFrom: "Zusage von",
      /** How the party's agreement reached the league, which the confirmation stores. */
      reason: "Begründung",
      /**
       * Why a fixture's save did not run, on the match editor, an Übersicht row's act or the Termin dialog alike: it
       * would delete a later match's result it was not asked about, a question only the match editor asks.
       */
      voidsLater: "Das löscht ein späteres Ergebnis.",
    },

    spielort: {
      /** The object of „Spielort anlegen“. */
      object: "Spielort",
      search: "Spielorte suchen",
      /** The create dialog's group of the address's lines, and the editor's box holding them. */
      address: "Adresse",
      street: "Straße",
      houseNumber: "Nr.",
      postcode: "PLZ",
      district: "Stadtteil",
      city: "Stadt",
      /** What a new venue's city starts as: the league plays in one city. */
      cityDefault: "Frankfurt am Main",
      mietpreis: "Mietpreis",
      /** The examples each box's message line shows where its value is off its pattern. */
      mietpreisExample: "60",
      postcodeExample: "60438",
      houseNumberExample: "12a",
      /** The danger box's two consequences, under the act's name and in its question alike. */
      retireConsequence: "Der Spielort steht für neue Spiele nicht mehr zur Auswahl.",
      reactivateConsequence: "Der Spielort steht wieder zur Auswahl.",
      /** The venue list's last entry, which opens the create dialog with the name typed so far. */
      createEntry: "Spielort anlegen",
      /** One line of a venue's address: its street and number. */
      streetWithHouseNumber: (street: string, houseNumber: string) => `${street} ${houseNumber}`,
      /** A whole address on one line, „Schulweg 8, 60317 Frankfurt am Main“, after its street line. */
      addressLine: (street: Copy, postcode: string, city: string) => `${street}, ${postcode} ${city}`,
    },

    /** A referee's fee for a match: the referee's own default, and a match's booking. */
    payment: "Honorar",
    /** The chip of a contact seat, and of a registration where it says confirmed. */
    confirmed: "Bestätigt",
    expired: "Abgelaufen",
    erased: "Gelöscht",
    /** „2 von 3“, a figure under its column's or its fact's name, where `SERVER_COPY.overview.seatsConfirmed` is a whole line. */
    seatsOf: (confirmed: number, seats: number) => `${formatNumber(confirmed)} von ${formatNumber(seats)}`,
    /** A seat row's one muted line: the seats held, the address, and where the answer stands. An emptied seat holds no address, an erased one no day. */
    seatLine: (rollen: readonly FLKontaktRolle[], address: string | null, day: Copy | null) =>
      [rollenText(rollen), address, day].filter((part) => part !== null).join(" · "),
    /** The name's place on an emptied seat. */
    seatEmpty: "Niemand",
    /** The description of a free text a mail hands to people it may not concern. */
    noNames: "Ohne Namen",
    /** The chip beside a seat's or a link's state, where its last mail met trouble. */
    delivery: {
      delayed: "Noch nicht zugestellt",
      undeliverable: "Unzustellbar",
      suppressed: "Zustellung blockiert",
      complaint: "Als Spam gemeldet",
      held: "Nur abgelegt",
    },

    /** The rows of a question's facts: a move's two slots, the season the site leaves and takes, and whom its act mails. */
    facts: {
      before: "Bisher",
      after: "Neu",
      fromNow: "Ab sofort",
      mailTo: "E-Mail an",
      enteredOn: "Eingetragen am",
      effectiveFrom: EFFECTIVE_FROM,
    },
    /** The place of an address the log's erasure step replaced, in „Wer“. */
    erasedActor: "Gelöschte Person",
    /** Löschungen' and the address change's answer to an address holding no record. */
    nothingAtAddress: "Unter dieser Adresse steht nichts.",
    /** „E-Mail an“'s values across the access pages. */
    mailTo: {
      holders: "Alle Administratoren",
      holdersAndPerson: "Alle Administratoren und die Person",
      bothAddresses: "Beide Adressen",
    },
    /** A venue's and a referee's danger box, holding the act retiring the record or bringing it back. */
    retirement: RETIREMENT,

    schiedsrichter: {
      search: "Schiedsrichter suchen",
      /** A referee who has not confirmed their entry: the chip after the name, and the note on the match editor's closed choice. */
      unconfirmed: "Unbestätigt",
      /** The editor's sections beyond the record's own name: how to reach the person, and what became of their link. */
      kontaktData: "Kontaktdaten",
      bestaetigung: "Bestätigung",
      /** The fact saying where the referee's confirmation stands, one of the four lines below. */
      state: "Stand",
      /** Beside the act that mailed a fresh link, and the save whose corrected address did: the address it went to. */
      sentTo: (address: string) => `An ${address} gesendet`,
      confirmedOn: (day: CalendarDay) => `Bestätigt am ${formatDate(day)}`,
      openUntil: (day: CalendarDay) => `Offen bis ${formatDate(day)}`,
      expiredOn: (day: CalendarDay) => `Abgelaufen am ${formatDate(day)}`,
      objectedOn: (day: CalendarDay) => `Widersprochen am ${formatDate(day)}`,
      /** The example a phone box's message names, from the Federal Network Agency's range for media use. */
      phoneExample: "069 90009123",
      retireConsequence: "Die Person steht für neue Spiele nicht mehr zur Auswahl.",
      reactivateConsequence: "Die Person steht wieder zur Auswahl.",
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
      period: "Zeitraum",
      /** A span's two days, the season's, each window's and a matchday's alike. */
      start: "Beginn",
      end: "Ende",

      /**
       * The editor's boxes, in the order of a season's life: its dates, its rules one box per what they govern (its
       * scoring, its groups and knockout stage, its squads), its windows, then what happens in it.
       */
      scoring: "Wertung",
      gruppenUndKoRunde: `Gruppen und ${K_O_RUNDE}`,
      /** The goals a no-show is scored with, named over their two boxes in the Wertung box. */
      forfeit: "Wertung bei Nichtantreten",
      bewerbungsfenster: "Bewerbungsfenster",
      registrierungsfenster: "Registrierungsfenster",
      gruppentausch: "Gruppentausch",
      replacement: "Ersatz",
      registrierungslinks: "Registrierungslinks",
      /** The danger box's title, by what its rows are about: the draw's regeneration and removal, the switch, or both. */
      dangerBox: (draw: boolean, activation: boolean) => (draw && activation ? "Spielplan und Umstellung" : draw ? "Spielplan" : "Umstellung"),

      /** The Wertung box's help behind its ⓘ: what its rules do, one statement a line. */
      scoringHelp: [
        "Punkte und Reihenfolge ordnen die Tabelle und sind ab Saisonbeginn gesperrt.",
        "Ein Nichtantreten zählt als Spiel mit den eingetragenen Toren.",
      ],
      /** The points a match gives by its result, named once over its three boxes in the Wertung box. */
      punkte: "Punkte",
      winPoints: "Sieg",
      drawPoints: "Unentschieden",
      lossPoints: "Niederlage",
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
      /** The application form paused: the window stands, and the form reads closed until the box is cleared. */
      bewerbungPaused: "Bewerbung pausiert",

      /** When the Spielplan was drawn, beside its counts. */
      drawnOn: "Angelegt",
      noDraw: "Noch kein Spielplan.",
      /**
       * Why the draw cannot run: a group holds more or fewer teams than the rules give each, or a club stands in a
       * group the rules do not run. One repair reaches all three, entering the clubs as the rules say.
       */
      gruppenOffRules: "Die Gruppen passen nicht zu den Regeln.",
      recreateConsequence: "Alle Spieltage und Spiele werden gelöscht und neu angelegt.",
      deleteConsequence: "Alle Spieltage und Spiele werden gelöscht.",

      /** The group swap's two clubs; the swap exchanges their groups. */
      swapFirst: TEAM_PAIR.team1,
      swapSecond: TEAM_PAIR.team2,
      /** A club or a pair a swap or a replacement can no longer move: one of its matches has taken place. */
      tookPlace: "Ein Spiel hat stattgefunden",
      /** The replacement's two clubs: the one leaving the season, and the one taking over its row. */
      outgoing: "Ausscheidendes Team",
      incoming: "Nachrückendes Team",
      /** What the replacement does: the incoming club takes the outgoing one's group and every match of it. */
      replaceConsequence: (incoming: Words, outgoing: Words, gruppe: string) =>
        `${textOf(incoming)} übernimmt ${GRUPPE(gruppe)} und alle Spiele von ${textOf(outgoing)}.`,

      /**
       * Why the draw cannot be redrawn or removed now: reports stand, the season went live, or a match holds something
       * entered since the draw beyond its date.
       */
      reportsHold: "Spielberichte liegen vor",
      lockedSinceActivation: "Seit der Umstellung gesperrt",
      entriesHold: "Spiele sind schon bearbeitet",

      /** Each team's registration link as its row states it, by what the press would do with it. */
      linkSentOn: (day: CalendarDay) => `Gesendet am ${formatDate(day)}`,
      linkNotSent: "Nicht gesendet",
      noLinkYet: "Noch kein Link",
      noConfirmedAddress: "Keine bestätigte Adresse",
      addressBarred: "Adresse auf der Sperrliste",
      /** The registration links' done line, the rows saying the rest. */
      sentTo: (count: number) => (count === 1 ? "An 1 Team gesendet" : `An ${formatNumber(count)} Teams gesendet`),
      /** The registration links' send: how many teams it mails. */
      dispatchConsequence: (count: number) =>
        count === 1 ? "1 Team bekommt seinen Link per E-Mail." : `${formatNumber(count)} Teams bekommen ihren Link per E-Mail.`,

      /** The activation: the season the site shows, and its subject, „Auf Saison 2027 umstellen?“. */
      isCurrent: "Die Website zeigt diese Saison.",
      onto: (saison: string) => `Auf ${saisonName(saison)}`,
      activateConsequence: (saison: string) => `Die Website zeigt ab sofort ${saisonName(saison)}.`,
      /** The activation's question, over the season the site leaves and the one it takes. */
      activateQuestion: "Die Website wechselt die Saison.",
      /** Why the activation cannot run yet: the season the site shows owes results, or this one's matchdays owe dates. */
      unfinished: "Die bisherige Saison hat noch Spiele ohne Ergebnis.",
      undated: "Diese Saison hat noch Spieltage ohne Datum.",
      /** Why the list's create cannot run: a planned season stands, and a league plans one season at a time. */
      futureStands: "Eine Saison ist schon geplant.",
    },

    spiel: {
      /** The editor of a match whose two teams are not both known yet, named by its number. */
      number: (nr: number) => `Spiel ${formatNumber(nr)}`,
      ansetzung: "Ansetzung",
      ergebnis: "Ergebnis",
      /** The players credited with a result's goals, as a field's message names what it must not hold. */
      scorers: "Torschützen",
      note: "Notiz",
      date: SPIEL_FACT.date,
      time: SPIEL_FACT.time,
      sonderereignis: "Sonderereignis",
      /** The Sonderereignis' first entry: nothing beyond the match being played. */
      none: "Keines",
      ausgefallen: SONDEREREIGNIS.ausgefallen,
      nichtantretenTeam1: "Nichtantreten Team 1",
      nichtantretenTeam2: "Nichtantreten Team 2",
      /** The fixture's two sides, by the names the Sonderereignis' entries give them. */
      team1: TEAM_PAIR.team1,
      team2: TEAM_PAIR.team2,
      abgebrochen: SONDEREREIGNIS.abgebrochen,
      annulliert: SONDEREREIGNIS.annulliert,
      /** Why a no-show cannot be picked while a side is open. */
      needsBothSides: "Nur mit beiden Teams",
      /** Why the result's switch is closed: the Sonderereignis composes the result, or leaves the match without one. */
      byEvent: "Folgt aus dem Sonderereignis",
      /** The save's done line where the write moved other matches too, by their numbers: „Auch Spiel 5 und 7 geändert“. */
      alsoChanged: (spiele: readonly number[]) => `Auch Spiel ${formatList(spiele.map(formatNumber))} geändert`,

      /** A knockout match's pairing, its editor's box, and the chip a match not yet confirmed carries in the Spiele list. */
      begegnung: "Begegnung",
      provisional: "Vorläufig",
      /** What the result's figures decide, under them in the editor: a club winning by the score, or a draw. */
      wins: (team: Words, score: Copy) => `${textOf(team)} gewinnt ${score}`,
      drawn: (score: Copy) => `Unentschieden ${score}`,
      /** A row's result: the goals, and after a shoot-out each side's goals and shoot-out goals added, marked „n. E.“. */
      score: (tore: Pair, elfmeterschiessen: Pair | null) =>
        elfmeterschiessen === null ? formatErgebnis(tore) : `${formatErgebnis(tore, elfmeterschiessen)} ${AFTER_ELFMETERSCHIESSEN}`,
      /** A matchday's dates over its matches, until it is dated what is still to settle. */
      span: (start: CalendarDay | null, end: CalendarDay | null) => (start === null || end === null ? DATE_OPEN : formatPeriod(start, end)),

      /** The match editor's sections beyond the three it shares with the old pages: a knockout match's clubs, the report and the answers. */
      spielbericht: "Spielbericht",
      confirmations: CONFIRMATIONS,
      /** The Vorschau under the editor's title: the match as stored, its pairing, when it is played and its result. */
      preview: (pairing: Copy, when: Copy, result: Copy) => `${pairing} · ${when} · ${result}`,
      noResult: "Noch kein Ergebnis",
      /** A club picked by hand over the side's source, which the side no longer follows once saved. */
      replacesQuelle: (quelle: Copy) => `Ersetzt ${quelle}`,
      /** Why a club cannot take a side: it stands on another match of the matchday, or has left the season. */
      onSpieltag: "Spielt schon an diesem Spieltag",
      departed: "Aus der Saison ausgeschieden",
      elfmeterschiessen: "Elfmeterschießen",
      /** The shoot-out's column head, the mark its score carries. */
      afterElfmeterschiessen: AFTER_ELFMETERSCHIESSEN,
      /** Level knockout goals saved without a shoot-out leave the match undecided, and the bracket after it. */
      shootOutMissing: "Ohne Elfmeterschießen steht kein Sieger fest.",
      /** An event after which the match carries no result, chosen over a stored one. */
      resultDropped: (score: Copy) => `Ergebnis ${score} wird verworfen`,
      /** The referee's proposal, which „Übernehmen“ carries into the fields: „Laut Spielbericht 3:1“. */
      fromReport: (result: Words) => `Laut Spielbericht ${textOf(result)}`,
      /** The report's goals as rows: what happened, the minute, and the score it made. */
      event: "Ereignis",
      minute: "Minute",
      /** What a declining club proposed, after its answer's date on the party's line. */
      proposed: (when: Copy) => `Vorschlag ${when}`,
      zugesagt: ZUGESAGT,
      /** A club's decline, and a referee's, as the glossary's `Absage` names the second. */
      declined: "Abgelehnt",
      cancelled: "Abgesagt",
      /** A rejection's and a club's exit's stated reason: its box and its fact. */
      reason: "Grund",
      answerBy: (day: CalendarDay) => `Antwort bis ${formatDate(day)}`,
      enteredByLeague: "Von der Verwaltung eingetragen",
      notAsked: "Noch nicht angefragt",
      /** A save voiding later matches' results, which it asks before. */
      voids: (spiele: readonly number[]) =>
        spiele.length === 1
          ? `Das Ergebnis von Spiel ${formatNumber(spiele[0] ?? 0)} wird gelöscht.`
          : `Die Ergebnisse von Spiel ${formatList(spiele.map(formatNumber))} werden gelöscht.`,
    },

    /** The Bewerbungen list, its two dialogs, the Sammel-Zusage and the review page. */
    bewerbung: {
      search: "Bewerbungen suchen",
      /** The day an application came in: a fact of the list, a card and the review page, and of a registration. */
      received: "Eingegangen",
      /** A row's chip and the status filter's option, by where the application stands. */
      incomplete: "Unvollständig",
      complete: "Vollständig",
      accepted: "Angenommen",
      /** An undecided application's `Dublette`, in the status chip's place on its row and beside it on its review page. */
      teamDouble: "Team doppelt",
      /** The origin filter, whose options are `newSchool` and `existingTeam`. */
      origin: "Herkunft",
      existingTeam: "Bestehendes Team",
      /** The acceptance's group over the open Kürzel box, and „Team eintragen“'s group and entry. */
      newSchool: "Neue Schule",
      /** A colour's description in the acceptance, by its `TRIKOT_FARBEN` name. */
      wish: (farbe: string) => `Wunsch: ${farbe}`,
      /** Over a list the read's cap cut, which a flooded season reaches. */
      cut: "Nicht alle Bewerbungen sind geladen.",
      /** The acceptance of a new school, whose address the created team's page then shows (`docs/datenschutz.md` section 4). */
      addressPublic: "Die Adresse der Schule steht danach öffentlich auf der Teamseite.",
      /** „E-Mail an“'s value in the acceptance: it waits on every seat's answer, so every seat holds a person to mail. */
      allSeats: "Alle Kontaktpersonen",
      /** „E-Mail an“'s value in the decline: a seat past the mailbox bound has heard of no application, so it hears of no decline. */
      mailedSeats: "Angeschriebene Kontaktpersonen",
      /** The bulk card's line over the record's name. */
      cardOf: (position: number, total: number) => `Bewerbung ${formatNumber(position)} von ${formatNumber(total)}`,
      /** The object of the bulk's button and of its question. */
      count: (count: number) => (count === 1 ? "1 Bewerbung" : `${formatNumber(count)} Bewerbungen`),
      acceptManyConsequence: (saison: string) => `Die Teams werden endgültig Teil der ${saisonName(saison)}.`,
      /** „E-Mail an“'s value in the bulk's question. An application names at least two people, so the count is never 1. */
      kontaktCount: (count: number) => `${formatNumber(count)} Kontaktpersonen`,
      /** The chip of a row the check page's confirm refused. */
      shorthandTaken: "Kürzel vergeben",
      /** The title of the bulk's end card. */
      acceptedCount: (count: number) => (count === 1 ? "1 Team aufgenommen" : `${formatNumber(count)} Teams aufgenommen`),
      /** The review page's facts of a decided application. */
      acceptedOn: "Angenommen am",
      declinedOn: "Abgelehnt am",
      /** „Annehmen“'s reason while locked, a seat open, objected or erased alike. */
      awaitsConfirmations: "Erst, wenn alle Kontaktpersonen bestätigt haben",
    },

    /** The Teams list, its create dialog and the team editor. */
    team: {
      search: "Teams suchen",
      /** A full group's greyed entry. */
      gruppeFull: "Voll",
      /** „Team eintragen“'s reason while locked. */
      onlyPlanned: "Nur in einer geplanten Saison",
      /** The state filter's option for a club playing on. */
      active: "Aktiv",
      enterDescription: "Ein bekanntes Team oder eine neue Schule",
      /** The field group over the season's fields in „Team eintragen“. */
      inSaison: (saison: string) => `In der ${saisonName(saison)}`,
      /** Under Name and Kürzel once changed: a finished season keeps the name it was played under. */
      renameReach: "Gilt für laufende und geplante Saisons.",
      /** The public text on the club's page. */
      description: "Beschreibung",
      descriptionNote: "Steht auf der Teamseite",
      austrittType: "Art",
      austrittFrom: "Wirksam ab",
      registrierungLink: "Registrierungslink",
      linkValidUntil: VALID_UNTIL,
      registrierungEnd: (day: CalendarDay) => `Ende der Registrierung, ${formatDate(day)}`,
      /** The one copy button's name, over a link shown once. */
      copyLink: "Link kopieren",
      linkOnce: "Der Link ist nur jetzt zu sehen.",
      /** Replacing the link and withdrawing it alike. */
      linkVoidConsequence: "Der bisherige Link gilt nicht mehr.",
      /** The danger box's title, by what its rows are about: the exit, the retiring, or both. */
      dangerBox: (austritt: boolean, retirement: boolean) =>
        austritt && retirement ? `Austritt und ${RETIREMENT}` : austritt ? "Austritt" : RETIREMENT,
      /** The exit's row and its dialog's title. */
      austrittAct: "Aus der Saison nehmen",
      austrittRowLine: "Das Team scheidet aus dieser Saison aus.",
      /** The exit's reason while locked: before the season's start the replacement is the route. */
      fromStart: "Erst ab Saisonbeginn",
      austrittReasonDescription: "Steht ohne Namen auf der Website",
      /** Under the exit's date: the write calls no fixture off, so the line says only what it ends. */
      austrittLine: "Offene Anfragen zu Spielen ab diesem Tag enden.",
      /** „E-Mail an“'s value in the exit's dialog. */
      austrittMailTo: "Gegner und eingeteilte Schiedsrichter",
      /** The danger box's two consequences, under the act's name and in its question alike, as a venue's. */
      retireConsequence: "Das Team steht für neue Saisons nicht mehr zur Auswahl.",
      reactivateConsequence: "Das Team steht wieder zur Auswahl.",
      /** The retiring's reason while locked. */
      retireLocked: "Nur ohne laufende oder geplante Saison",
    },

    /** The Spieler list and its editor. */
    spieler: {
      search: "Spieler suchen",
      /** A row's chips, and with `inKader` the state filter's options. */
      nominee: "Nachnominiert",
      deregistered: "Ausgetragen",
      inKader: "Im Kader",
      nummerDouble: "Nummer doppelt",
      /** The editor's boxes and fields. */
      person: "Person",
      deregisteredOn: "Ausgetragen am",
      nummer: "Nummer",
      position: "Position",
      stufe: "Stufe",
      rolle: "Rolle",
      rolleOption: { kapitaen: "Kapitän", co_kapitaen: "Co-Kapitän" } satisfies Record<FLSpielerRolle, string>,
      /** The read-only box of what the pupil chose. */
      einwilligung: "Einwilligung",
      nameOnSite: "Name auf der Website",
      media: "Fotos und Videos",
      mediaYes: "Ja",
      mediaNo: "Nein",
      givenOn: "Erteilt am",
      confirmedOn: "Bestätigt am",
      /** The danger box's title, and the object of its reactivation. */
      kaderEntry: "Kadereintrag",
      /** The object of „Aus dem Kader austragen“. */
      fromKader: "Aus dem Kader",
      /** The danger box's two consequences, under the act's name and in its question alike. */
      deregisterConsequence: "Die Person steht in dieser Saison nicht mehr im Kader.",
      reactivateConsequence: "Die Person steht wieder im Kader.",
    },

    /** The Registrierungen list. */
    registrierung: {
      search: "Registrierungen suchen",
      /** Over a list the read's cap cut, which a link passed around reaches. */
      cut: "Nicht alle Registrierungen sind geladen.",
    },

    /** Administratoren: the grants, what waits among them, and the acts on either. */
    administrators: {
      /** The object of „Administrator eintragen“ and „Administrator entfernen“. */
      object: "Administrator",
      /** The owner's chip, and the object of the handover. */
      owner: OWNER_TIER,
      /** The heading over what waits. */
      pending: "Angekündigt",
      /** A grant's `effective_from`, as a date under this label. */
      since: "Seit",
      pendingKind: { addition: "Neuer Administrator", handover: `Übergabe der ${OWNER_TIER}` },
      /** A waiting row's one muted line: what waits, a new address where one does, and its date. */
      pendingLine: (kind: Copy, address: string | null, moment: string) =>
        [kind, address, `${EFFECTIVE_FROM} ${formatInstantShort(moment)}`].filter((part) => part !== null).join(" · "),
      additionConsequence: (wait: Wait) => `Der Zugang gilt ${waitWords(wait).after}.`,
      removeConsequence: "Der Zugang endet sofort.",
      handoverConsequence: (wait: Wait) => `Die ${OWNER_TIER} geht ${waitWords(wait).after} über, und du bleibst in der Verwaltung.`,
      /** Why the handover is locked. */
      handoverRunning: "Übergabe läuft schon",
      /** A withdrawal's sentence, by what waited; an address change's is `addressChange.previousStays`. */
      withdrawConsequence: {
        addition: "Die Adresse bekommt keinen Zugang.",
        handover: `Die ${OWNER_TIER} bleibt bei dir.`,
      },
    },

    /** Sperrliste: a ban's two dialogs and what a ban's write can leave undone. */
    banList: {
      /** The object of „Sperre eintragen“ and „Sperre entfernen“, and the block's title in the ban's mail. */
      object: "Sperre",
      /** The list's plural in its empty states, and a pass's noun. */
      plural: BANS,
      search: `${BANS} suchen`,
      consequence: "Die Adresse kann sich nicht mehr anmelden und bekommt keine E-Mails.",
      duration: "Dauer",
      durationSaisons: (count: number) => (count === 1 ? "1 Saison" : `${formatNumber(count)} Saisons`),
      /** The dialog's line once the ban stands, by what did not follow it. */
      partial: {
        sessions: "Die Sperre steht, aber die Anmeldungen laufen weiter.",
        notice: "Die Sperre steht, aber die E-Mail ist nicht raus.",
        both: "Die Sperre steht, aber Anmeldungen und E-Mail sind offen.",
        /** The second press's note, once it ended what the first left running. */
        ended: "Die Anmeldungen sind beendet.",
      },
      liftConsequence: "Die Adresse kann sich wieder anmelden.",
    },

    /** Löschungen: the one form, its confirmation and the counts it shows. */
    erasure: {
      /** The reason's box, a free text no check reads. */
      reference: "Referenz der Anfrage",
      /** The object of „Daten löschen“. */
      object: "Daten",
      consequence: "Alles unter dieser Adresse wird endgültig gelöscht.",
      /** The rows a confirmation counts beyond the entries `shared` and `page` name. */
      count: {
        teamSeats: "Sitze in Teams",
        bewerbungSeats: "Sitze in Bewerbungen",
        spiele: "Eingeteilte Spiele",
        addressChanges: "Laufende Adressänderungen",
        grant: "Zugang",
      },
      /** The dialog's note, the account undeleted or unknown: the dialog stays open, so „Löschen“ retries. */
      partial: "Die Daten sind gelöscht, das Konto vielleicht nicht.",
    },

    /** Adressänderungen: the running changes and the start's dialog. */
    addressChange: {
      /** A row's chip, by what the change waits on. */
      waitsOn: { previous_address: "Bisherige offen", new_address: "Neue offen", waiting_period: "Wartezeit" } satisfies Record<
        FLAddressChangeWaitsOn,
        string
      >,
      /** The column of the moment a row's step ends. */
      until: "Bis",
      /** That column's value while a link is open, and in the wait. */
      untilCell: (moment: string) => `bis ${formatInstantShort(moment)}`,
      fromCell: (moment: string) => `ab ${formatInstantShort(moment)}`,
      startConsequence: (wait: Wait) => `Die neue Adresse gilt ${waitWords(wait).span} nach ihrer Bestätigung.`,
      /** A callout, the typed address matching a listed row. */
      replaces: "Eine laufende Änderung wird ersetzt.",
      /** A withdrawal's and a discard's sentence. */
      previousStays: "Die bisherige Adresse bleibt.",
    },

    /** The Protokoll: its one list, its filters and each row's words, composed from the stored action. */
    actionLog: {
      search: "Einträge suchen",
      what: "Was",
      who: "Wer",
      when: "Wann",
      /** „Wer“'s option and value for a scheduled pass. */
      automatic: "Automatisch",
      /** „Zeitraum“'s presets. */
      time: {
        days: (count: number) => `Letzte ${formatNumber(count)} Tage`,
      },
      /** „Wer“ of a team's representative. */
      actor: { contact: (team: Words) => `Kontaktperson · ${textOf(team)}`, contactNoTeam: "Kontaktperson" },
      /** A pass's label: one form, so a count of 1 needs no singular. */
      passCount: (noun: Copy, count: number) => `${noun}: ${formatNumber(count)}`,
      /** What a pass deleted, the noun of `passCount`, by the pass's stored action. */
      passNoun: {
        "retention.bewerbungen": BEWERBUNGEN,
        "retention.kontakte": KONTAKTPERSONEN,
        "retention.spielbestaetigungen": CONFIRMATIONS,
        "retention.spielberichte": "Spielberichte",
        "retention.registrierungen": REGISTRIERUNGEN,
        "retention.schiedsrichter": SCHIEDSRICHTER,
        "retention.spieler": SPIELER,
        "retention.address_changes": ADDRESS_CHANGES,
        "retention.bans": BANS,
      } satisfies Record<Extract<FLAction, `retention.${string}`>, string>,
      /** A row's word, by its stored action. */
      action: {
        "saison.created": "Saison angelegt",
        "saison.changed": "Saison geändert",
        "saison.activated": "Saison umgestellt",
        "saison.gruppen_swapped": "Gruppen getauscht",
        "saison.spielplan_created": "Spielplan angelegt",
        "saison.spielplan_recreated": "Spielplan neu angelegt",
        "saison.spielplan_deleted": "Spielplan gelöscht",
        "saison.invitations_dispatched": "Registrierungslinks gesendet",
        "spieltag.changed": "Spieltag geändert",
        "spiel.changed": "Spiel geändert",
        "spiel.ergebnis_changed": "Ergebnis geändert",
        "spielbestaetigung.entered": "Zusage eingetragen",
        "spielbestaetigung.vorschlag_discarded": "Vorschlag verworfen",
        "spielbestaetigung.vorschlag_adopted": "Vorschlag übernommen",
        "spielbestaetigung.answered": "Termin beantwortet",
        "spielbericht.saved": "Spielbericht eingetragen",
        "aufstellung.saved": "Aufstellung eingetragen",
        "team.entered": "Team eingetragen",
        "team.changed": "Team geändert",
        "team.retired": "Team stillgelegt",
        "team.reactivated": "Team reaktiviert",
        "team.austritt_entered": "Austritt eingetragen",
        "team.seat_changed": "Sitz geändert",
        "team.replaced": "Team ersetzt",
        "team.invitation_created": "Registrierungslink angelegt",
        "team.invitation_withdrawn": "Registrierungslink zurückgezogen",
        "bewerbung.accepted": "Bewerbung angenommen",
        "bewerbung.declined": "Bewerbung abgelehnt",
        "bewerbung.seat_changed": "Sitz geändert",
        "spieler.changed": "Spieler geändert",
        "spieler.deregistered": "Spieler ausgetragen",
        "spieler.reactivated": "Spieler reaktiviert",
        "registrierung.admitted": "Registrierung angenommen",
        "registrierung.declined": "Registrierung abgelehnt",
        "schiedsrichter.created": "Schiedsrichter angelegt",
        "schiedsrichter.changed": "Schiedsrichter geändert",
        "schiedsrichter.retired": "Schiedsrichter stillgelegt",
        "schiedsrichter.reactivated": "Schiedsrichter reaktiviert",
        "spielort.created": "Spielort angelegt",
        "spielort.changed": "Spielort geändert",
        "spielort.retired": "Spielort stillgelegt",
        "spielort.reactivated": "Spielort reaktiviert",
        "grant.added": "Administrator eingetragen",
        "grant.removed": "Administrator entfernt",
        "grant.addition_withdrawn": "Eintragung zurückgezogen",
        "grant.handover_started": "Übergabe gestartet",
        "grant.handover_withdrawn": "Übergabe zurückgezogen",
        "grant.handover_completed": "Übergabe abgeschlossen",
        "grant.address_change_started": "Adressänderung gestartet",
        "grant.address_switched": "Adresse gewechselt",
        "ban.added": "Sperre eingetragen",
        "ban.removed": "Sperre entfernt",
        "address_change.started": "Adressänderung eingetragen",
        "address_change.discarded": "Adressänderung verworfen",
        "erasure.on_request": "Löschung auf Anfrage",
        "erasure.own": ACCOUNT_ERASED,
        "retention.bewerbungen": DELETED_BY_PASS,
        "retention.kontakte": DELETED_BY_PASS,
        "retention.spielbestaetigungen": DELETED_BY_PASS,
        "retention.spielberichte": DELETED_BY_PASS,
        "retention.registrierungen": DELETED_BY_PASS,
        "retention.schiedsrichter": DELETED_BY_PASS,
        "retention.spieler": DELETED_BY_PASS,
        "retention.address_changes": DELETED_BY_PASS,
        "retention.bans": DELETED_BY_PASS,
      } satisfies Record<FLAction, string>,
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
