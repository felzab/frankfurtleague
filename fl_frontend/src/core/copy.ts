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

import type { CalendarDay, Pair, TimeOfDay } from "./format";
import type {
  FLAction,
  FLActionLogPageSize,
  FLAddressChangeWaitsOn,
  FLAustrittType,
  FLCardColour,
  FLKontaktSeat,
  FLSaisonPhase,
  FLSchulform,
  FLSonderereignis,
  FLSpielerRolle,
  FLSpielerStufe,
  FLSpielSide,
  FLTrikotFarbe,
  FLWithdrawalChoice,
} from "./generated/client/types";

declare const copyBrand: unique symbol;

/** In the order `seatsText` joins them. */
const KONTAKT_SEAT_LONG_FORM = {
  ansprechperson: "Ansprechperson",
  stellvertretung: "Stellvertretung",
  trainer: "Trainerin oder Trainer",
} as const satisfies Record<FLKontaktSeat, string>;

/**
 * The seats one reader holds, as the phrase a page or a mail addresses them by. In the table's order rather than the
 * argument's: a person holding two seats reads one phrase whichever record the seats were collected from.
 */
export function seatsText(seats: readonly FLKontaktSeat[]): string {
  const order = Object.keys(KONTAKT_SEAT_LONG_FORM) as FLKontaktSeat[];

  return formatList(order.filter((seat) => seats.includes(seat)).map((seat) => KONTAKT_SEAT_LONG_FORM[seat]));
}

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

export const textOf = (words: Words): string => (typeof words === "string" ? words : words.record);

type Catalogue<T> = T extends string
  ? Copy
  : T extends (...args: infer A) => string
    ? (...args: A) => Copy
    : { readonly [K in keyof T]: Catalogue<T[K]> };

/**
 * The only assertion to `Copy`: the whole tree is branded at once, so no entry can be left plain. Called anywhere but
 * the two catalogues, it would brand a typed string as the catalogue's.
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
  lineUp: "Aufstellen",
  edit: "Bearbeiten",
  swap: "Tauschen",
  replace: "Ersetzen",
  handOver: "Übergeben",
  recreate: "Neu anlegen",
  activate: "Umstellen",
  retire: "Stilllegen",
  reactivate: "Reaktivieren",
  next: "Weiter",
  skip: "Überspringen",
} as const;

/** The closed set of button verbs: a button names its act with one of these. */
export type Verb = keyof typeof VERB;

const infinitive = (verb: Verb): string => `${VERB[verb].charAt(0).toLowerCase()}${VERB[verb].slice(1)}`;

// The glossary's spelling.
const K_O_RUNDE = "K.-o.-Runde";
const GRUPPE = (gruppe: string) => `Gruppe ${gruppe}`;

const DATE_OPEN = "Termin offen";
// The mark beside a score a shoot-out decided, its two parts joined by a no-break space so a narrow row never parts them.
const AFTER_ELFMETERSCHIESSEN = "n.\u00A0E.";
const SIGN_IN = "Anmeldung";
const SIGN_IN_WITH_PASSKEY = "Mit Passkey anmelden";
const SET_UP_PASSKEY = { title: "Passkey einrichten", button: "Jetzt einrichten" } as const;
const PASSKEY_WITHOUT_CODE = "Mit einem Passkey meldest du dich ohne Code an.";
const PASSKEY_REQUIRED = "Die Verwaltung ist erst mit einem Passkey erreichbar.";
const SPIELER = "Spieler";
const SCHIEDSRICHTER = "Schiedsrichter";
const KADER = "Kader";
const ENTRY = "Eintrag";
// The privacy notice's title, which the deletion box's sentence names as the place listing what outlives an erasure.
const PRIVACY_NOTICE = "Datenschutz";
const RETIREMENT = "Stilllegung";

/**
 * Each reason an editor's fields can stand locked for, as its lock line says it after „Gesperrt“, in the order the
 * line says them. Each is as short as its meaning allows: the line never wraps, and the longest pair, „Gesperrt seit
 * Saisonbeginn und durch Spielplan.“, fills most of a 360-px phone's line.
 */
const LOCK = {
  /**
   * The season's start has passed, which fixes its scoring, its qualifiers and its clubs, and once a result is stored,
   * which no match takes before the start, the start date itself.
   */
  sinceStart: "seit Saisonbeginn",
  /** The season's start is still to come, before which no match takes a result. */
  untilStart: "bis Saisonbeginn",
  /** A Spielplan stands: the counts it was drawn from and a club's group move only with a new draw. */
  byDraw: "durch Spielplan",
  /** The club left the season, which fixes its group and its colour. */
  departed: "seit dem Ausscheiden",
  /** The person confirmed their entry, which fixes the address their sign-in is keyed to: only an address change moves it. */
  confirmed: "seit der Bestätigung",
  /** The season has finished, which fixes a player's squad row: the number, position, level and role, and the row's place in the squad. */
  sinceEnd: "seit Saisonende",
} as const;

/** Why some of an editor's fields stand locked, which its lock line says once however many it holds. */
export type LockReason = keyof typeof LOCK;

const saisonName = (id: string) => `Saison ${id}`;
// The same name with a no-break space, for a phrase binding a word to it.
const saisonNameBound = (id: string) => boundBy("Saison", id);
const spieltagName = (position: number) => `${formatOrdinal(position)} Spieltag`;
const teamSeason = (team: Words, saison: Copy) => `${textOf(team)}, ${saison}`;
const startelfCount = (count: number, max: number) => `Startelf ${formatNumber(count)} ${boundBy("von", formatNumber(max))}`;
const OWNER_TIER = "Leitung";
const BEWERBUNGEN = "Bewerbungen";
const REGISTRIERUNGEN = "Registrierungen";
const KONTAKTPERSONEN = "Kontaktpersonen";
const CONFIRMATIONS = "Bestätigungen";
const ADDRESS_CHANGES = "Adressänderungen";
const BANS = "Sperren";
const EFFECTIVE_FROM = "Gilt ab";
const VALID_UNTIL = "Gültig bis";
const ENTERED_ON = "Eingetragen am";
const SINCE = "Seit";
const AFTER = "Neu";
const ACCOUNT_ERASED = "Konto gelöscht";
const DELETED = "Gelöscht";
// One word for every retention pass, its noun saying what it took.
const DELETED_BY_PASS = "Nach Frist gelöscht";
// One word for every person's objection through their own link, a seat's and a referee's alike: the act's question was
// „Eintrag widersprechen?“.
const ENTRY_OBJECTED = "Eintrag widersprochen";
// One word for every withdrawal an administrator entered from a person's mail, on any kind of record.
const WITHDRAWAL_ENTERED = "Widerruf eingetragen";
const NAME_ON_SITE = "Name auf der Website";
const MEDIA = "Fotos und Videos";

/**
 * A wait a sentence states, in the unit its bound is published in. Each figure is a literal, so a bound that moves fails
 * the type check here rather than printing a wrong plural.
 */
export type Wait = { readonly hours: 24 } | { readonly days: 7 };

/** A wait's two German forms, digits always: `span` after „gilt erst“, and `after` taking the dative. */
export const waitWords = (wait: Wait) =>
  "hours" in wait
    ? { span: boundBy(formatNumber(wait.hours), "Stunden"), after: boundBy("nach", formatNumber(wait.hours), "Stunden") }
    : { span: boundBy(formatNumber(wait.days), "Tage"), after: boundBy("nach", formatNumber(wait.days), "Tagen") };

/**
 * „bis 12.11.2026, 17:54“, „nach 15 Tagen“, „für die Saison 2027“, „Erst ab 16 Jahren“: the words of a phrase joined by
 * no-break spaces, so a line never ends on a preposition or an article apart from its value, nor on a number apart from
 * its unit. A phrase of several words takes each as a part: `boundBy("für", "die", saison)`. Only the spaces it joins
 * bind, so a value holding a space of its own comes bound: a season's name as `saisonNameBound`, and a short instant,
 * whose date and time `formatInstantShort` binds. Prose before words with no value, „bis zum Ende der Saison“, breaks
 * as any words do. A mail's subject joins nothing: it is one header line, which a mail program shows and searches as
 * typed.
 */
export const boundBy = (...parts: string[]) => parts.join("\u00A0");

export const LINE_SEPARATOR = " \u00B7 ";

/** A row's one muted line: its parts in their order, a part the row lacks left out. */
const lineOf = (parts: readonly (string | null)[]) => parts.filter((part) => part !== null).join(LINE_SEPARATOR);

const SENT_ON = "Gesendet am";

export const COPY = catalogue({
  /** What every area draws from; an area adds a key of its own only for a string this lacks. */
  shared: {
    verb: VERB,
    withObject: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}`,
    line: (parts: readonly (Words | null)[]) => lineOf(parts.map((part) => (part === null ? null : textOf(part)))),

    unit: {
      euro: "€",
      minute: "Min.",
    },

    /** A field's one message line: what is expected, never the field's name. */
    field: {
      required: "Pflichtfeld",
      maxChars: (count: number) => `Höchstens ${boundBy(formatNumber(count), "Zeichen")}`,
      minChars: (count: number) => `Mindestens ${boundBy(formatNumber(count), "Zeichen")}`,
      format: (example: Copy) => `Format: ${example}`,
      // A reserved domain, so no reader takes the example for the address the league expects.
      exampleAddress: "name@example.com",
      // A name's examples, by the box, each within the backend's name pattern: letters, hyphens, apostrophes and spaces.
      exampleName: "Anna Weber",
      exampleFirstName: "Anna",
      exampleLastName: "Weber",
      // A digits field's example: figures alone, whatever the field counts.
      exampleDigits: "123",
      exampleDate: "31.12.2026",
      // Reserved as the address example's domain is.
      exampleUrl: "https://example.com",
      /** The example a phone box's message names, from the Federal Network Agency's range for media use. */
      examplePhone: "069 90009123",
      between: (from: number, to: number) => `Zwischen ${formatNumber(from)} und ${formatNumber(to)}`,
      // One-sided bounds of a number or of a list, the box's label saying what is counted.
      max: (count: number) => `Höchstens ${formatNumber(count)}`,
      min: (count: number) => `Mindestens ${formatNumber(count)}`,
      without: (thing: Copy) => boundBy("Ohne", thing),
      earliest: (day: CalendarDay) => `Frühestens ${formatDate(day)}`,
      latest: (day: CalendarDay) => `Spätestens ${formatDate(day)}`,
      taken: "Schon vergeben",
    },

    /** The three lines every refusal no person causes knowingly from the screen falls back to. */
    failure: {
      unexpected: "Etwas ist schiefgelaufen",
      stale: "Die Seite ist nicht mehr aktuell.",
      signInExpired: "Deine Anmeldung ist abgelaufen.",
      /** A press past any limit on tries, whatever was counted: the edge's rate, a code's wrong tries, an address's codes. */
      tooManyAttempts: "Zu viele Versuche.",
      /** An administrator's grant is gone or was never held: no sign-in and no retry repairs it. */
      accessGone: "Dein Zugang zur Verwaltung besteht nicht mehr.",
    },
    /** An act the passkey touch guards, sent without a passkey sign-in of the last minute by a person holding one. */
    touchMissing: "Die Bestätigung mit deinem Passkey fehlt.",

    saved: "Gespeichert",
    retired: "Stillgelegt",

    state: {
      active: "Aktiv",
      confirmed: "Bestätigt",
      unconfirmed: "Unbestätigt",
      objected: "Widersprochen",
      erased: DELETED,
      expired: "Abgelaufen",
      agreed: "Zugesagt",
      /** A club's decline and a referee's alike; a match called off reads as its event, „Ausgefallen“. */
      declined: "Abgelehnt",
      nominee: "Nachnominiert",
      linkSent: "Gesendet",
      linkNotSent: "Nicht gesendet",
    },
    confirmedOn: (day: CalendarDay) => `Bestätigt ${boundBy("am", formatDate(day))}`,
    expiredOn: (day: CalendarDay) => `Abgelaufen ${boundBy("am", formatDate(day))}`,
    objectedOn: (day: CalendarDay) => `Widersprochen ${boundBy("am", formatDate(day))}`,
    answerBy: (day: CalendarDay) => `Antwort ${boundBy("bis", formatDate(day))}`,
    afterConfirmation: "Erst nach Bestätigung",
    afterHandover: `Erst nach Übergabe ${boundBy("der", OWNER_TIER)}`,
    reason: "Grund",
    /** The description of a free text a mail hands to people it may not concern. */
    noNames: "Ohne Namen",
    mediaFrom: (age: number) => `Erst ${boundBy("ab", formatNumber(age), "Jahren")}`,

    administration: "Verwaltung",
    owner: OWNER_TIER,
    payment: "Honorar",

    emailAddress: "E-Mail-Adresse",
    link: "Link",
    addressChange: {
      /** The pending change's noun, „Änderung zurückziehen“, the glossary's screen word. */
      change: "Änderung",
      current: "Bisherige E-Mail-Adresse",
      new: "Neue E-Mail-Adresse",
      previousStays: "Die bisherige Adresse bleibt.",
    },
    passkey: "Passkey",
    passkeys: "Passkeys",

    address: {
      title: "Adresse",
      street: "Straße",
      houseNumber: "Nr.",
      postcode: "PLZ",
      district: "Stadtteil",
      city: "Stadt",
      /** What a new address's city starts as: the league plays in one city. */
      cityDefault: "Frankfurt am Main",
      postcodeExample: "60438",
      houseNumberExample: "12a",
      streetWithHouseNumber: (street: string, houseNumber: string) => `${street} ${houseNumber}`,
      addressLine: (street: Copy, postcode: string, city: string) => `${street}, ${postcode} ${city}`,
    },

    /** The toast titles; a toast carries no body. */
    toast: {
      copied: "Kopiert",
      linkSent: "Link gesendet",
      othersSignedOut: "Alle anderen abgemeldet",
      admitted: "Aufgenommen",
      /**
       * An act behind the passkey touch done, by its verb: its question or dialog closed before the touch, so the toast
       * is where it answers. A handover only starts its wait, as its row under „Angekündigt“ says.
       */
      done: {
        remove: "Entfernt",
        withdraw: "Zurückgezogen",
        discard: "Verworfen",
        delete: DELETED,
        recreate: "Neu angelegt",
        activate: "Umgestellt",
        enter: "Eingetragen",
        handOver: "Übergabe angekündigt",
      } satisfies Partial<Record<Verb, string>>,
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
      /** A run's list a person left every row out of: the records stand, where `none` would say there are none yet. */
      skipped: (plural: Copy) => `Alle ${plural} übersprungen.`,
    },

    /** „Passkey löschen?“: a confirmation asks with the verb its button carries. */
    question: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}?`,
    back: "Zurück",
    close: "Schließen",

    end: {
      doneOn: (done: Copy, day: CalendarDay) => `${done} ${boundBy("am", formatDateLong(day))}`,
      toHome: "Zur Startseite",
      toAccount: "Zum Konto",
      toOverview: "Zur Übersicht",
      toTeams: "Zu den Teams",
    },

    toSpiel: "Zum Spiel",
    toTeam: "Zum Team",
    entry: ENTRY,
    /** A fact nobody has entered, where a sentence names it in words rather than a glyph. */
    notProvided: "Nicht hinterlegt",
    /** A value not there yet: a glyph, not a word. */
    noValue: "–",
    /** A pupil or a referee whose consent publishes no name, or one erased since; client components name a pupil too, so it stands here. */
    anonymous: "anonym",
    /** A list's entry naming nobody, the same word opening the entry. */
    nobody: "Anonym",
    /** Between a pairing's two sides where no score stands between them: a glyph, not a word. */
    versus: "–",
    overview: "Übersicht",
    switchRole: "Funktion wechseln",
    loadMore: `Weitere ${50 satisfies FLActionLogPageSize} laden`,
    kORunde: K_O_RUNDE,
    kOBaum: "K.-o.-Baum",
    phase: {
      gruppenphase: "Gruppenphase",
      achtelfinale: "Achtelfinale",
      viertelfinale: "Viertelfinale",
      halbfinale: "Halbfinale",
      finale: "Finale",
    } satisfies Record<FLSaisonPhase, string>,
    spieltag: spieltagName,
    /** A knockout matchday where its phase spans several: the phase's name and the matchday's place in it. */
    knockoutRound: (phase: Copy, position: number) => `${phase} (${formatNumber(position)})`,
    afterElfmeterschiessen: AFTER_ELFMETERSCHIESSEN,
    /**
     * The two routes out of a season, each in its three wordings: `label` names the record, `state` the club's
     * resulting state, `shorthand` the badge.
     */
    austritt: {
      disqualifikation: { label: "Disqualifikation", state: "Disqualifiziert", shorthand: "DQ" },
      rueckzug: { label: "Rückzug", state: "Zurückgezogen", shorthand: "RZ" },
    } satisfies Record<FLAustrittType, { label: string; state: string; shorthand: string }>,
    /** A club's exit note's head: its route's `state` and the day it took effect. */
    austrittSince: (state: Copy, day: CalendarDay) => `${state} ${boundBy("seit", formatDate(day))}`,
    startelf: "Startelf",
    bank: "Bank",
    /**
     * The boxed mark after the name of a squad's Kapitän and its Co-Kapitän; its accessible name is the role's own,
     * `kader.rolleOption`.
     */
    rolleMark: { kapitaen: "C", co_kapitaen: "Co" } satisfies Record<FLSpielerRolle, string>,
    tore: "Tore",
    name: "Name",
    firstName: "Vorname",
    lastName: "Nachname",
    facts: {
      birthday: "Geburtsdatum",
      phone: "Telefon",
      school: "Schule",
      team: "Team",
      state: "Stand",
      received: "Eingegangen",
      before: "Bisher",
      after: AFTER,
      effectiveFrom: EFFECTIVE_FROM,
    },
    teamPair: { team1: "Team 1", team2: "Team 2" } satisfies Record<FLSpielSide, string>,
    /** The record's name, the object of its acts. */
    bewerbung: "Bewerbung",
    ban: "Sperre",
    /** The rows an erasure removes beyond the entries `shared` and `page` name. */
    erasureCount: { addressChanges: "Laufende Adressänderungen", grant: "Zugang" },
    spieler: SPIELER,
    schiedsrichter: SCHIEDSRICHTER,
    kader: KADER,

    /**
     * The kit's season blocks that a client component draws: a table's rows reach the list's client table. The
     * rest, which only the server draws, stand in `SERVER_COPY.season`.
     */
    season: {
      gruppe: GRUPPE,
      /**
       * The name of the mark beside a club's figure: how many of its fixtures ended with no result, called off or struck
       * out, in the words their events' consequence says them (\u201EDas Spiel wird nicht gewertet.\u201C).
       */
      cancelled: (count: number) => (count === 1 ? "1\u00A0Spiel nicht gewertet" : `${boundBy(formatNumber(count), "Spiele")} nicht gewertet`),
      /** The mark itself, drawn red on the corner of a club's figure and hidden from a screen reader, which hears `cancelled`. */
      cancelledMark: (count: number) => `+${formatNumber(count)}`,
    },

    help: "Hilfe",
    filter: "Filter",
    done: "Fertig",
    saison: "Saison",
    /** A season by its id, which is its year and so takes no thousands separator. */
    saisonName,
    /**
     * The same name joined by a no-break space, for a line binding a label to it, such as a ban's
     * „Gültig bis Saison 2027“, so the line never ends on „Saison“ apart from its year. Everywhere else the name keeps
     * its plain space: a mail's subject, a tab's title and any words a person matches or searches as typed.
     */
    saisonNameBound,

    /**
     * The bot check's one answer a person can act on, its click shown or its judgement against the token; a check that
     * did not load, mint or reach Cloudflare is the unexpected failure.
     */
    botCheck: "Die Bestätigung, dass du ein Mensch bist, fehlt.",
  },

  /** Each page's own name, keyed by its `ROUTES` key; a name several pages share is one entry, keyed by its noun. */
  page: {
    spielplan: "Spielplan",
    tabelle: "Tabelle",
    teams: "Teams",
    spielSearch: "Spielsuche",
    /** A match's page, named by its two teams in the order the fixture lists them. */
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
    adminWithdrawals: "Widerrufe",
    adminAddressChanges: ADDRESS_CHANGES,
    adminActionLog: "Protokoll",
    addressChangeConfirmation: "Änderung der E-Mail-Adresse",
    entryConfirmation: `${ENTRY} ${infinitive("confirm")}`,
    registrierungConfirmation: "Registrierung bestätigen",
    accountErasure: "Konto löschen",
    registrierung: "Registrierung",
    bewerbung: (saison: string) => `Bewerbung ${saisonName(saison)}`,
  },

  /** The public application form's own words; what the administration names alike stands in `team`. */
  bewerbung: {
    schoolDescription: "Die Schulen, die schon mitgespielt haben",
    schoolNotListed: "Meine Schule ist nicht in der Liste",
    teamNameDescription: "Kurz, wie das Team genannt wird",
    stufengroesseDescription: "Wie viele im Abi-Jahrgang sind",
    /** Each seat confirms for one person, which a shared inbox would let one person do for two. */
    ownAddress: "Die eigene Adresse der Person",
    seatCovered: "Übernimmt die Trainerin oder der Trainer.",
    /** A promise the form makes, which the privacy record states. */
    addressPublic: "Steht nach der Zusage öffentlich auf der Teamseite",
    trikotSetDescription: "Zum Beispiel 15\u00A0rote Trikots",
    goodSpielerDescription: "Aktiv, mindestens Verbandsliga",
    wunschgegnerDescription: `Für den ${spieltagName(1)}`,
    suggestions: "Vorschläge anzeigen",
    /**
     * The sentence above the submit, in the two parts around the privacy notice's title, which the form sets as its
     * link.
     */
    notice: { before: "Jede Kontaktperson bestätigt ihren Eintrag per E-Mail, mehr unter\u00A0", after: "." },
  },

  /** The public registration form's own words; its squad fields read the labels `kader` gives them. */
  registrierung: {
    box: "Deine Angaben",
    /** Under the address: the confirmation link goes there, and one address signs one person in. */
    ownAddress: "Deine eigene Adresse",
    /** The number box's label, the shirt's own word, which a pupil reads where the squad's lists say „Nummer“. */
    nummer: "Trikotnummer",
    /** The sentence above the submit, in the two parts around the privacy notice's title, as `bewerbung.notice`. */
    notice: { before: "Du bestätigst deine Registrierung per E-Mail, mehr unter\u00A0", after: "." },
  },

  /** A club's fields, one word each wherever a person meets them. */
  team: {
    kontakte: KONTAKTPERSONEN,
    seatName: KONTAKT_SEAT_LONG_FORM,
    seat: "Sitz",
    /** An emptied seat holds no address, an erased one no day. */
    seatLine: (seats: readonly FLKontaktSeat[], address: string | null, day: Copy | null) => lineOf([seatsText(seats), address, day]),
    seatEmpty: "Niemand",
    teamName: "Teamname",
    fullName: "Vollständiger Name",
    shorthand: "Kürzel",
    /** By the length the backend fixes a club's code at. */
    shorthandDescription: (length: number) => boundBy(formatNumber(length), "Buchstaben"),
    shorthandFixed: "Vergeben, als das Team angelegt wurde",
    /** No real club's code, so no reader takes it for one. */
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
    /** Each kit colour's name in the league's colour sheet. */
    trikotFarbeName: {
      schwarz: "Schwarz",
      weiss: "Weiß",
      grau: "Grau",
      braun: "Braun",
      bordeaux: "Bordeaux",
      rot: "Rot",
      koralle: "Koralle",
      orange: "Orange",
      gold: "Gold",
      gelb: "Gelb",
      limette: "Limette",
      hellgruen: "Hellgrün",
      gruen: "Grün",
      smaragd: "Smaragd",
      tuerkis: "Türkis",
      cyan: "Cyan",
      hellblau: "Hellblau",
      meerblau: "Meerblau",
      blau: "Blau",
      dunkelblau: "Dunkelblau",
      flieder: "Flieder",
      violett: "Violett",
      magenta: "Magenta",
      rosa: "Rosa",
    } satisfies Record<FLTrikotFarbe, string>,
    wunschfarbe: "Wunschfarbe",
    stufengroesse: "Größe der Stufe",
    trikotSet: "Vorhandene Trikotsätze",
    expectedKader: "Voraussichtliche Kadergröße",
    goodSpieler: "Davon im Verein",
    wunschgegner: "Wunschgegner",
    /** The select in the Trainer's box, whose two other entries are `seatName`'s. */
    trainerAlso: {
      label: "Übernimmt zugleich",
      description: "Eine Person kann 2\u00A0Rollen haben.",
      none: "Keine weitere Rolle",
    },
  },

  spielplan: {
    spieltage: "Spieltage",
    /** Until a match is dated, what is still to settle. */
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

    /** What befell a match: a no-show names the club that did not turn up. */
    sonderereignis: {
      label: "Sonderereignis",
      /** The box's first entry: nothing beyond the match being played. */
      none: "Keines",
      ausgefallen: "Ausgefallen",
      nichtantreten: (team: Words) => `${textOf(team)} nicht angetreten`,
      /** A no-show's chip in a match row, whose struck side names the club. */
      nichtantretenChip: "Nicht angetreten",
      abgebrochen: "Abgebrochen",
      annulliert: "Annulliert",
      /**
       * What the event means for the result, under its name in the pop-up's callout, which the name does not
       * repeat: a match called off or struck out awards nothing, a no-show awards the side that turned up the
       * forfeit the season's rules set, which the score shows, and an abandoned match owes a result until one is
       * entered.
       */
      consequence: {
        notScored: "Das Spiel wird nicht gewertet.",
        nichtantreten: (opponent: Words) => `Das Spiel wird ${boundBy("für", textOf(opponent))} gewertet.`,
        abgebrochenScored: "Das eingetragene Ergebnis wird gewertet.",
        abgebrochenOpen: "Die Wertung steht noch nicht fest.",
      },
    },

    fact: {
      spieltag: "Spieltag",
      date: "Datum",
      time: "Uhrzeit",
      spielort: "Ort",
      schiedsrichter: SCHIEDSRICHTER,
    },

    ergebnis: "Ergebnis",
    spielbericht: "Spielbericht",
    scorers: "Torschützen",
    goal: "Tor",
    minute: "Minute",
    elfmeterschiessen: "Elfmeterschießen",
    /** Level knockout goals saved without a shoot-out leave the match undecided, and the bracket after it. */
    shootOutMissing: "Ohne Elfmeterschießen steht kein Sieger fest.",
    /** Why the result's switch is closed: the Sonderereignis composes the result, or leaves the match without one. */
    byEvent: "Folgt aus dem Sonderereignis",
    /** The chip of a knockout match whose pairing is not yet confirmed. */
    provisional: "Vorläufig",
    /** A row's result: the goals, and after a shoot-out each side's goals and shoot-out goals added, marked „n. E.“. */
    score: (tore: Pair, elfmeterschiessen: Pair | null) =>
      elfmeterschiessen === null ? formatErgebnis(tore) : `${formatErgebnis(tore, elfmeterschiessen)} ${AFTER_ELFMETERSCHIESSEN}`,
    /** What the result's figures decide: a club winning by the score, or a draw. */
    wins: (team: Words, score: Copy) => `${textOf(team)} gewinnt ${score}`,
    drawn: (score: Copy) => `Unentschieden ${score}`,
    noResult: "Noch kein Ergebnis",
    preview: (pairing: Copy, when: Copy, result: Copy) => `${pairing} · ${when} · ${result}`,

    answer: "Antwort",
    appointment: "Termin",
    vorschlag: "Vorschlag",
    proposed: (when: Copy) => `Vorschlag ${when}`,
    answerNote: "Begründung",
    enteredByLeague: "Von der Verwaltung eingetragen",
  },

  /** A squad row's fields, one word each wherever a person meets them. */
  kader: {
    search: "Spieler suchen",
    nummer: "Nummer",
    position: "Position",
    stufe: "Stufe",
    stufeName: { E1: "E1", E2: "E2", Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4" } satisfies Record<FLSpielerStufe, string>,
    rolle: "Rolle",
    rolleOption: { kapitaen: "Kapitän", co_kapitaen: "Co-Kapitän" } satisfies Record<FLSpielerRolle, string>,
    deregistered: "Ausgetragen",
    nummerDouble: "Nummer doppelt",
    fromKader: "Aus dem Kader",
    deregisterConsequence: "Die Person steht in dieser Saison nicht mehr im Kader.",
  },

  aufstellung: {
    plural: "Aufstellungen",
    ofTeam: (team: Words) => `Aufstellung ${textOf(team)}`,
    /** Where no line-up stands, under a name that already says what is missing. */
    missing: "Fehlt",
    startelfCount,
    counts: (picked: number, starting: number, max: number) => `${formatNumber(picked)} aufgestellt · ${startelfCount(starting, max)}`,
    rest: "Nicht aufgestellt",
    /**
     * Why „Aufstellen“ is locked on a nominee's row once the line-up names `max` of the squad's own players, a nominee
     * filling a shortage alone: the bound the backend publishes, never a typed figure.
     */
    nomineeLocked: (max: number) => `Nur bei weniger ${boundBy("als", formatNumber(max))}`,
    needsSlot: "Erst mit Datum und Uhrzeit",
    dueBy: (day: CalendarDay) => `Aufstellung ${boundBy("bis", formatDate(day))}`,
    overdueSince: (day: CalendarDay) => `Aufstellung ${boundBy("seit", formatDate(day))} überfällig`,
    overdue: "Überfällig",
    overdueOnCard: "Aufstellung überfällig",
    /** Once the team's seats can change nothing more before the match. */
    locked: "Gesperrt",
    lockedLine: "Änderungen trägt jetzt die Liga ein.",
  },

  template: {
    more: "Mehr",
    less: "Weniger",
    showAll: "Alle anzeigen",
    navigation: "Navigation",
    /** The account's place, one word signed in and out alike. */
    account: "Konto",
    menu: "Menü",
    theme: { system: "System", light: "Hell", dark: "Dunkel" },
    /** Named for what the next press does. */
    sidebar: { collapse: "Seitenleiste einklappen", expand: "Seitenleiste ausklappen" },

    contents: "Inhalt",

    liga: "Liga",
    legal: "Rechtliches",
    /** The footer's way to the application's address, which answers whether or not a window is open. */
    bewerbung: "Bewerbung",
    oberstufenliga: "Die Frankfurter Oberstufenliga",
    supportedBy: "Mit Unterstützung von",
    instagram: "Instagram",
    threads: "Threads",
    copyright: (year: number, brand: Copy) => `© ${String(year)} ${brand}`,

    changes: "Änderungen",
    changesPending: (count: number) => (count === 1 ? "1\u00A0Änderung" : boundBy(formatNumber(count), "Änderungen")),
    changesLost: (count: number) =>
      count === 1 ? "1\u00A0Änderung geht verloren." : `${boundBy(formatNumber(count), "Änderungen")} gehen verloren.`,
    /** While an editor's draft holds unsaved changes, which close every act of it. */
    draftUnsaved: "Gesperrt, solange Änderungen ungespeichert sind",
    /**
     * An editor's one lock line, muted under its title: the reasons its fields stand locked for, each once, in `LOCK`'s
     * order, „Gesperrt seit Saisonbeginn und durch Spielplan.“; each locked field carries the lock mark at its label.
     */
    lockLine: (reasons: readonly LockReason[]) =>
      `Gesperrt ${formatList((Object.keys(LOCK) as LockReason[]).filter((by) => reasons.includes(by)).map((by) => LOCK[by]))}.`,
    /** A finished season, which shuts every acceptance: why „Annehmen“ is locked. */
    closed: "Abgeschlossen",
    /** A save refused for its fields: the fields say what, the status line that some are off. */
    checkFields: "Einige Felder sind nicht richtig ausgefüllt.",
    open: "Offen",

    /** A page a mail opened whose link no longer holds: one title for an expired, mistyped or tampered link alike. */
    linkInvalid: "Link nicht mehr gültig",
  },

  signIn: {
    title: VERB.signIn,

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

    passkey: {
      setUp: { ...SET_UP_PASSKEY, sentence: PASSKEY_REQUIRED },
      signIn: { title: SIGN_IN_WITH_PASSKEY, sentence: PASSKEY_REQUIRED, button: "Jetzt anmelden" },
      offer: { ...SET_UP_PASSKEY, sentence: PASSKEY_WITHOUT_CODE },
      later: "Später",
    },

    /**
     * The code's and the passkey's refusals, which the page words off the sign-in library's own codes. A barred
     * address and one holding no record meet one sentence, so nobody can probe the ban list.
     * The typed code's own refusal is a phrase under its boxes, a wrong code and one no longer valid alike; every other
     * is a sentence on the status line.
     */
    refusal: {
      codeWrong: "Falsch oder nicht mehr gültig",
      noRecord: "Mit dieser Adresse ist keine Anmeldung möglich.",
      unverified: "Dieser Passkey hat nicht bestätigt, dass du es bist.",
    },
  },

  account: {
    address: {
      description: "Mit dieser Adresse meldest du dich an.",
      /**
       * The pending change, in the two parts around its new address, which the box sets semibold between them: waiting
       * on the address on file's link, which confirms first, or on the new address's own, by the step's deadline.
       */
      pending: {
        before: "Die neue Adresse",
        previous: (until: string | null) =>
          until === null
            ? "wartet auf die Bestätigung deiner bisherigen Adresse."
            : `wartet ${boundBy("bis", formatInstant(until))} auf die Bestätigung deiner bisherigen Adresse.`,
        new: (until: string | null) =>
          until === null ? "wartet auf ihre Bestätigung." : `wartet ${boundBy("bis", formatInstant(until))} auf ihre Bestätigung.`,
        /** Both addresses have confirmed and the wait runs. */
        waiting: (moment: string) => `gilt ${boundBy("ab", formatInstant(moment))}.`,
      },
      /** The step the change waits on lapsed; the hourly pass ends it. */
      lapsed: "Die Änderung ist abgelaufen.",
      stop: "Änderung stoppen",
      /** A holder's own change, which waits whole. */
      holderWait: (wait: Wait) => `Die neue Adresse gilt erst ${waitWords(wait).span}, nachdem beide Adressen sie bestätigt haben.`,
    },
    erasure: {
      // What outlives an erasure is the privacy notice's to list, never this sentence's.
      description: `Dein Konto und deine Angaben werden gelöscht, bis auf das, was unter „${PRIVACY_NOTICE}“ steht.`,
      consequence: "Den Link zum Löschen bekommst du per E-Mail.",
      done: ACCOUNT_ERASED,
    },
    passkeys: {
      description: PASSKEY_WITHOUT_CODE,
      /** When a passkey was set up, and when it last signed in where it has. */
      dates: (created: Date, lastUsed: Date | null) =>
        lastUsed === null
          ? `Eingerichtet ${boundBy("am", formatDate(created))}`
          : `Eingerichtet ${boundBy("am", formatDate(created))} · Zuletzt verwendet ${boundBy("am", formatDate(lastUsed))}`,
      /**
       * The deletion's consequence, which the question words before the passkey touch: the devices the passkey signed
       * in, and this one where the page's session was made by it or it is the person's only passkey, which the touch
       * then has to be.
       */
      endsDevices: "Geräte, die damit angemeldet sind, werden abgemeldet.",
      endsThisDevice: "Auch dieses Gerät wird abgemeldet.",
      /** An administrator's last passkey, their only way into the administration. */
      lastKept: "Der letzte Passkey lässt sich nicht löschen.",
      /** The same, as the deletion's tooltip. */
      lastKeptLocked: "Letzter Passkey bleibt",
      /** The set-up's tooltip at the cap, which no refusal on a status line words. */
      limit: (count: number) => `Höchstens ${boundBy(formatNumber(count), "Passkeys")}`,
      /** A first passkey set up past the sign-in library's `freshAge`. */
      signInTooOld: "Deine Anmeldung liegt zu lange zurück.",
      /** The same, as the set-up's tooltip. */
      signInTooOldLocked: "Erst nach neuer Anmeldung",
      /** A further passkey set up on an authenticator holding one of the person's already. */
      alreadyOnDevice: "Auf diesem Gerät hast du schon einen Passkey.",
    },
    devices: {
      title: "Geräte",
      description: (count: number) =>
        count === 1 ? "Du bist auf\u00A01\u00A0Gerät angemeldet." : `Du bist ${boundBy("auf", formatNumber(count), "Geräten")} angemeldet.`,
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
      seats: (saison: Copy, seats: readonly FLKontaktSeat[]) => `${saison} · ${seatsText(seats)}`,
    },
    /**
     * Each record an address holds, as Deine Einträge boxes it: titled by what the record is, a team's seats by the
     * team's name, the rest by `shared`'s noun or the page's, and described by the person's part in it.
     */
    entries: {
      plural: "Einträge",
      /** Each entry box's one sentence, by the kind of record it holds, naming the role the person holds in it. */
      description: {
        spieler: "Dein Eintrag als Spielerin oder Spieler im Kader und was davon öffentlich ist.",
        registrierung: "Deine Registrierung als Spielerin oder Spieler und was davon öffentlich ist.",
        schiedsrichter: "Dein Eintrag als Schiedsrichterin oder Schiedsrichter und was davon öffentlich ist.",
        /** A seat on a team's season and a seat in an application alike, by the seats held, in the seats' order. */
        seat: (seats: readonly FLKontaktSeat[]) => `Dein Eintrag ${boundBy("als", seatsText(seats))} und wie wir dich erreichen.`,
      },
      teamSeason,
      /** A seat entry's fact where its seats store the person typed two ways, by the seats holding this one: „Telefon als Ansprechperson“. */
      seatFact: (label: Copy, seats: readonly FLKontaktSeat[]) => `${label} ${boundBy("als", seatsText(seats))}`,
      /**
       * The labels the deletion's list names an address's records by, each the person's part in the record: one row per
       * label, holding the records it names.
       */
      spieler: "Als Spielerin oder Spieler",
      schiedsrichter: "Als Schiedsrichterin oder Schiedsrichter",
      /** The seats a contact person holds on one row, as one phrase in the seats' order: „Als Ansprechperson und Trainerin oder Trainer“. */
      seats: (seats: readonly FLKontaktSeat[]) => boundBy("Als", seatsText(seats)),
      bewerbung: (saison: Copy) => `Bewerbung ${boundBy("für", "die", saison)}`,
      /** A pupil's registration, by its team where the team still stands. */
      registrierung: (team: Words | null, saison: Copy) =>
        team === null ? `Registrierung ${boundBy("für", "die", saison)}` : `Registrierung ${boundBy("für", teamSeason(team, saison))}`,
      /** One label's records, where an address holds several under it. */
      several: (records: readonly Words[]) => formatList(records.map(textOf)),
    },
  },

  /**
   * The words a client component under `/area` reads, for a team's contact seats, a pupil and a referee. What another
   * area reads too stands in `shared` or its noun's section, and what only a server page reads in `SERVER_COPY.area`.
   */
  area: {
    spieler: {
      lineupPlace: { starts: "In der Startelf", bench: "Auf der Bank" },
    },

    team: {
      accountLine: (shorthand: Words, seats: readonly FLKontaktSeat[]) => `${textOf(shorthand)} · ${seatsText(seats)}`,
      /**
       * What the league decides: the decline dialog's one sentence, a proposal moving nothing until the league saves a
       * date; and the last part of an expired date's line on the Übersicht, which takes no answer past its deadline. A
       * declined row's line ends on the team's proposal.
       */
      declineConsequence: "Über den Termin entscheidet die Liga.",
      leagueDecides: "Die Liga entscheidet",

      registrierung: {
        search: "Registrierungen suchen",
        /**
         * The page's one standing line above the list, filled or empty, in the two parts around the league's address,
         * which the page sets as its link: only the league mints and mails a team's link.
         */
        linkFromLeague: { before: "Den Registrierungslink schickt die Liga, erreichbar unter\u00A0", after: "." },
        /** The registration's address is a stored person's. */
        returning: "War schon in der Liga",
        /** Why „Aufnehmen“ is locked: the squad is at its cap, or the pupil's own link is unanswered. */
        kaderFull: "Kader voll",
        declineConsequence: "Die Person kommt nicht in den Kader.",
        /**
         * The admission of a registration whose address is a stored person's under other details: the line under the
         * dialog's title names that person, and the two choices say whose registration it is. A contact seat is served
         * no address, so the line names the person alone.
         */
        earlierEntry: (name: Words) => `Ein früherer Eintrag nennt ${textOf(name)}.`,
        admitAs: (name: Words) => `${boundBy("Als", textOf(name))} aufnehmen`,
        otherPerson: "Andere Person, ablehnen",
      },
    },

    schiedsrichter: {
      search: "Spiele suchen",
      einteilung: "Einteilung",
      /** A game's chip on the referee's list once their report is stored, apart from the action log's entry of the same words. */
      reported: "Spielbericht eingetragen",

      /** The match report's form; a goal's and a result's words are `spielplan`'s. */
      spielbericht: {
        /** The played minute, and stoppage time after a plus. */
        minuteExample: "90+3",
        cards: "Karten",
        card: "Karte",
        colour: { gelb: "Gelb", gelb_rot: "Gelb-Rot", rot: "Rot" } satisfies Record<FLCardColour, string>,
        remarks: "Bemerkungen",
        /** A goal's or a card's row, counting the rows from 1. */
        numbered: (noun: Copy, number: number) => `${noun} ${formatNumber(number)}`,
        /** The status card of a match called off or struck out, which takes no report. */
        befell: { ausgefallen: "Spiel ausgefallen", annulliert: "Spiel annulliert" } satisfies Partial<Record<FLSonderereignis, string>>,
      },
    },
  },

  /** The administration's own words, which no page outside it reads. */
  admin: {
    group: {
      saisonsAndSpiele: "Saisons und Spiele",
      schulenAndSpieler: "Schulen und Spieler",
      accessAndPrivacy: "Zugang und Datenschutz",
    },

    overview: {
      zusage: "Zusage",
      /** Which of the row's open parties agreed: one segment each. */
      zusageFrom: "Zusage von",
      /**
       * Why a fixture's save did not run, on the match editor, an Übersicht row's act or the Termin dialog alike: it
       * would delete a later match's result it was not asked about, a question only the match editor asks.
       */
      voidsLater: "Das löscht ein späteres Ergebnis.",
    },

    spielort: {
      object: "Spielort",
      search: "Spielorte suchen",
      mietpreis: "Mietpreis",
      mietpreisExample: "60",
      retireConsequence: "Der Spielort steht für neue Spiele nicht mehr zur Auswahl.",
      reactivateConsequence: "Der Spielort steht wieder zur Auswahl.",
    },

    /**
     * Why a choice waits for the season's start: the team editor's exit, whose route before the start is the replacement,
     * and the match editor's events that record the match, offered disabled until then. In the lock line's own words, as
     * the match editor's line says the same lock above them.
     */
    untilStart: `Gesperrt ${LOCK.untilStart}`,
    /** Why a finished season's player editor offers no removal or return of the squad row, in the lock line's own words. */
    sinceEnd: `Gesperrt ${LOCK.sinceEnd}`,
    /** „2 von 3“, a figure under its column's or its fact's name, where `SERVER_COPY.overview.seatsConfirmed` is a whole line. */
    seatsOf: (confirmed: number, seats: number) => `${formatNumber(confirmed)} ${boundBy("von", formatNumber(seats))}`,
    /** A seat's or a link's chip where its last mail met trouble. */
    delivery: {
      delayed: "Noch nicht zugestellt",
      undeliverable: "Unzustellbar",
      suppressed: "Zustellung blockiert",
      complaint: "Als Spam gemeldet",
      held: "Nur abgelegt",
      /** The outbox gave the mail up after its tries, where „Nicht gesendet“ is a link no mail was ever owed. */
      abandoned: "Versand gescheitert",
    },

    facts: {
      fromNow: "Ab sofort",
      mailTo: "E-Mail an",
      enteredOn: ENTERED_ON,
    },
    /** The place of an address the log's erasure step replaced. */
    erasedActor: "Gelöschte Person",
    nothingAtAddress: "Unter dieser Adresse steht nichts.",
    mailTo: {
      holders: "Alle Administratoren",
      holdersAndPerson: "Alle Administratoren und die Person",
      bothAddresses: "Beide Adressen",
    },
    retirement: RETIREMENT,

    schiedsrichter: {
      search: "Schiedsrichter suchen",
      kontaktData: "Kontaktdaten",
      confirmation: "Bestätigung",
      sentTo: (address: string) => `${boundBy("An", address)} gesendet`,
      retireConsequence: "Die Person steht für neue Spiele nicht mehr zur Auswahl.",
      reactivateConsequence: "Die Person steht wieder zur Auswahl.",
    },

    saison: {
      /**
       * The groups and the qualifiers per group multiply to no bracket the league plays, the two counts together being
       * at fault.
       */
      bracketImpossible: `Aus diesen Zahlen entsteht keine ${K_O_RUNDE}.`,

      period: "Zeitraum",
      start: "Beginn",
      end: "Ende",

      /**
       * The editor's boxes, in the order of a season's life: its dates, its rules one box per what they govern (its
       * scoring, its groups and knockout stage, its squads), its windows, then what happens in it.
       */
      scoring: "Wertung",
      gruppenAndKoRunde: `Gruppen und ${K_O_RUNDE}`,
      forfeit: "Wertung bei Nichtantreten",
      bewerbungsfenster: "Bewerbungsfenster",
      registrierungsfenster: "Registrierungsfenster",
      gruppentausch: "Gruppentausch",
      replacement: "Ersatz",
      invitations: "Registrierungslinks",
      /** By what its rows are about: the draw's regeneration and removal, the switch, or both. */
      dangerBox: (draw: boolean, activation: boolean) => (draw && activation ? "Spielplan und Umstellung" : draw ? "Spielplan" : "Umstellung"),

      /** What the Wertung rules do, one statement a line. */
      scoringHelp: [
        "Punkte und Reihenfolge ordnen die Tabelle und sind ab Saisonbeginn gesperrt.",
        "Ein Nichtantreten zählt als Spiel mit den eingetragenen Toren.",
      ],
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
      /** The registration link paused: the window stands, and a link opens nothing until the box is cleared. */
      registrierungPaused: "Registrierung pausiert",
      /** A running season storing no registration window: a link opens nothing until the season's editor stores one. */
      noRegistrierungWindow: "Kein Registrierungsfenster",
      /** The application form paused: the window stands, and the form reads closed until the box is cleared. */
      bewerbungPaused: "Bewerbung pausiert",

      drawnOn: "Angelegt",
      noDraw: "Noch kein Spielplan.",
      /** The same, as the activation's tooltip. */
      noDrawLocked: "Erst mit Spielplan",
      /**
       * Why the draw cannot run: a group holds more or fewer teams than the rules give each, or a club stands in a
       * group the rules do not run. One repair reaches all three, entering the clubs as the rules say.
       */
      gruppenOffRules: "Die Gruppen passen nicht zu den Regeln.",
      /** The same, as the draw's tooltip. */
      gruppenOffRulesLocked: "Gruppen weichen von Regeln ab",
      recreateConsequence: "Alle Spieltage und Spiele werden gelöscht und neu angelegt.",
      deleteConsequence: "Alle Spieltage und Spiele werden gelöscht.",

      /** The replacement's two clubs: the one leaving the season, and the one taking over its row. */
      outgoing: "Ausscheidendes Team",
      incoming: "Nachrückendes Team",
      /** What the replacement does: the incoming club takes the outgoing one's group and every match of it. */
      replaceConsequence: (incoming: Words, outgoing: Words, gruppe: string) =>
        `${textOf(incoming)} übernimmt ${GRUPPE(gruppe)} und alle Spiele ${boundBy("von", textOf(outgoing))}.`,

      /**
       * Why the draw cannot be redrawn or removed now: reports stand, the season went live, or a match holds something
       * entered since the draw beyond its date.
       */
      reportsHold: "Spielberichte liegen vor",
      lockedSinceActivation: "Seit der Umstellung gesperrt",
      entriesHold: "Spiele sind schon bearbeitet",

      /**
       * Each team's registration link as its row states it, by what the press would do with it; a sent one's day also on
       * the links table's line on a phone, whose box leaves the „Gesendet am“ column out.
       */
      linkSentOn: (day: CalendarDay) => `${SENT_ON}\u00A0${formatDate(day)}`,
      sentOn: SENT_ON,
      noLinkYet: "Noch kein Link",
      noConfirmedAddress: "Keine bestätigte Adresse",
      addressBarred: "Adresse auf der Sperrliste",
      /** The rows say the rest. */
      sentTo: (count: number) => (count === 1 ? "An\u00A01\u00A0Team gesendet" : `${boundBy("An", formatNumber(count), "Teams")} gesendet`),
      dispatchConsequence: (count: number) =>
        count === 1
          ? "1\u00A0Team bekommt seinen Link per E-Mail."
          : `${boundBy(formatNumber(count), "Teams")} bekommen ihren Link per E-Mail.`,

      /** The activation's subject, and the season the site shows from then on. */
      onto: (saison: string) => boundBy("Auf", saisonNameBound(saison)),
      activateConsequence: (saison: string) => `Die Website zeigt ab sofort ${boundBy("die", saisonNameBound(saison))}.`,
      activateQuestion: "Die Website wechselt die Saison.",
      /** Why the activation cannot run yet: the season the site shows owes results, or this one's matchdays owe dates. */
      unfinished: "Die bisherige Saison hat noch Spiele ohne Ergebnis.",
      undated: "Diese Saison hat noch Spieltage ohne Datum.",
      /** The same two, as the activation's tooltip. */
      unfinishedLocked: "Erst mit allen Ergebnissen",
      undatedLocked: "Noch Spieltage ohne Datum",
      /** Why the list's create cannot run: a planned season stands, and a league plans one season at a time. */
      futureStands: "Eine Saison ist schon geplant.",
      /** The same, as the create's tooltip. */
      futureStandsLocked: "Eine Saison ist schon geplant",
    },

    spiel: {
      /** The editor of a match whose two teams are not both known yet, named by its number. */
      number: (nr: number) => `Spiel ${formatNumber(nr)}`,
      ansetzung: "Ansetzung",
      note: "Notiz",
      nichtantretenTeam1: "Nichtantreten Team 1",
      nichtantretenTeam2: "Nichtantreten Team 2",
      /** Why a no-show cannot be picked while a side is open. */
      needsBothSides: "Nur mit beiden Teams",
      /** Where the write moved other matches too, by their numbers. */
      alsoChanged: (spiele: readonly number[]) => `Auch Spiel ${formatList(spiele.map(formatNumber))} geändert`,

      begegnung: "Begegnung",
      /** Until a matchday is dated, what is still to settle. */
      span: (start: CalendarDay | null, end: CalendarDay | null) => (start === null || end === null ? DATE_OPEN : formatPeriod(start, end)),

      confirmations: CONFIRMATIONS,
      /** A club picked by hand over the side's source, which the side no longer follows once saved. */
      replacesQuelle: (quelle: Copy) => `Ersetzt ${quelle}`,
      /** Why a club cannot take a side: it stands on another match of the matchday, or has left the season. */
      onSpieltag: "Spielt schon an diesem Spieltag",
      departed: "Aus der Saison ausgeschieden",
      /** An event after which the match carries no result, chosen over a stored one. */
      resultDropped: (score: Copy) => `Ergebnis ${score} wird verworfen`,
      fromReport: (result: Words) => `Laut Spielbericht ${textOf(result)}`,
      event: "Ereignis",
      notAsked: "Noch nicht angefragt",
      /** A save voiding later matches' results, which it asks before. */
      voids: (spiele: readonly number[]) =>
        spiele.length === 1
          ? `Das Ergebnis von Spiel ${formatNumber(spiele[0] ?? 0)} wird gelöscht.`
          : `Die Ergebnisse von Spiel ${formatList(spiele.map(formatNumber))} werden gelöscht.`,
    },

    bewerbung: {
      search: "Bewerbungen suchen",
      incomplete: "Unvollständig",
      complete: "Vollständig",
      accepted: "Angenommen",
      /** An undecided application's `Dublette`. */
      teamDouble: "Team doppelt",
      /** The origin filter, whose options are `newSchool` and `existingTeam`. */
      origin: "Herkunft",
      existingTeam: "Bestehendes Team",
      newSchool: "Neue Schule",
      /** By the colour's `trikotFarbeName`. */
      wish: (farbe: string) => `Wunsch: ${farbe}`,
      /** The acceptance of a new school, whose address the created team's page then shows. */
      addressPublic: "Die Adresse der Schule steht danach öffentlich auf der Teamseite.",
      /** „E-Mail an“'s value in the acceptance: it waits on every seat's answer, so every seat holds a person to mail. */
      allSeats: "Alle Kontaktpersonen",
      /** „E-Mail an“'s value in the decline: a seat past the mailbox bound has heard of no application, so it hears of no decline. */
      mailedSeats: "Angeschriebene Kontaktpersonen",
      cardOf: (position: number, total: number) => `Bewerbung ${formatNumber(position)} ${boundBy("von", formatNumber(total))}`,
      count: (count: number) => (count === 1 ? "1\u00A0Bewerbung" : boundBy(formatNumber(count), "Bewerbungen")),
      acceptManyConsequence: (saison: string) => `Die Teams werden endgültig Teil der ${saisonName(saison)}.`,
      /** „E-Mail an“'s value in the bulk's question. An application names at least two people, so the count is never 1. */
      kontaktCount: (count: number) => boundBy(formatNumber(count), "Kontaktpersonen"),
      shorthandTaken: "Kürzel vergeben",
      acceptedCount: (count: number) =>
        count === 1 ? "1\u00A0Bewerbung angenommen" : `${boundBy(formatNumber(count), "Bewerbungen")} angenommen`,
      acceptedOn: "Angenommen am",
      declinedOn: "Abgelehnt am",
    },

    team: {
      search: "Teams suchen",
      gruppeFull: "Voll",
      /** „Team eintragen“'s reason while locked, and „Annehmen“'s in a running season: either enters a club. */
      onlyPlanned: "Nur in einer geplanten Saison",
      enterDescription: "Ein bekanntes Team oder eine neue Schule",
      inSaison: (saison: string) => boundBy("In", "der", saisonNameBound(saison)),
      /** Under Name and Kürzel once changed: a finished season keeps the name it was played under. */
      renameReach: "Gilt für laufende und geplante Saisons",
      description: "Beschreibung",
      descriptionNote: "Steht auf der Teamseite",
      austrittType: "Art",
      austrittFrom: "Wirksam ab",
      registrierungLink: "Registrierungslink",
      /** The link box's day from which an entry through the link is a Nachnominierung, the link opening on until the season ends. */
      nomineeFrom: "Nachnominierung ab",
      copyLink: "Link kopieren",
      linkOnce: "Der Link ist nur jetzt zu sehen.",
      linkVoidConsequence: "Der bisherige Link gilt nicht mehr.",
      /** By what its rows are about: the exit, the retiring, or both. */
      dangerBox: (austritt: boolean, retirement: boolean) =>
        austritt && retirement ? `Austritt und ${RETIREMENT}` : austritt ? "Austritt" : RETIREMENT,
      austrittAct: "Aus der Saison nehmen",
      austrittRowLine: "Das Team scheidet aus dieser Saison aus.",
      austrittReasonDescription: "Steht ohne Namen auf der Website",
      /**
       * Under the exit's date: the write calls no fixture off, so the line says only what it ends, the club's requests,
       * and that its seats lose the line-up's page and its reminders, so the league alone enters a line-up from then.
       */
      austrittLine: "Offene Anfragen zu Spielen ab diesem Tag enden, Aufstellungen trägt die Liga ein.",
      retireConsequence: "Das Team steht für neue Saisons nicht mehr zur Auswahl.",
      reactivateConsequence: "Das Team steht wieder zur Auswahl.",
      retireLocked: "Team spielt noch eine Saison",
    },

    spieler: {
      person: "Person",
      deregisteredOn: "Ausgetragen am",
      einwilligung: "Einwilligung",
      nameOnSite: NAME_ON_SITE,
      media: MEDIA,
      mediaYes: "Ja",
      mediaNo: "Nein",
      givenOn: "Erteilt am",
      confirmedOn: "Bestätigt am",
      kaderEntry: "Kadereintrag",
      reactivateConsequence: "Die Person steht wieder im Kader.",
    },

    administrators: {
      object: "Administrator",
      pending: "Angekündigt",
      since: SINCE,
      /** A grant's row line on a phone, whose box leaves the „Seit“ column out: „Seit 12.11.2026“. */
      sinceOn: (moment: string) => boundBy(SINCE, formatDate(new Date(moment))),
      pendingKind: { addition: "Neuer Administrator", handover: `Übergabe der ${OWNER_TIER}` },
      /** A waiting row's one muted line: what waits, a new address where one does, and its date. */
      pendingLine: (kind: Copy, address: string | null, moment: string) =>
        lineOf([kind, address, boundBy(EFFECTIVE_FROM, formatInstantShort(moment))]),
      additionConsequence: (wait: Wait) => `Der Zugang gilt ${waitWords(wait).after}.`,
      removeConsequence: "Der Zugang endet sofort.",
      handoverConsequence: (wait: Wait) => `Die ${OWNER_TIER} geht ${waitWords(wait).after} über, und du bleibst in der Verwaltung.`,
      /** Why the handover is locked: one runs, or no administrator holds access to take it over. */
      handoverRunning: "Übergabe läuft schon",
      noAdministrator: "Noch kein Administrator",
      /** Why the owner's acts, on the toolbar and on every row, are locked for an administrator, who reads the page. */
      ownerOnly: `Nur für die ${OWNER_TIER}`,
      /** A withdrawal's sentence, by what waited; an address change's is `shared.addressChange.previousStays`. */
      withdrawConsequence: {
        addition: "Die Adresse bekommt keinen Zugang.",
        handover: `Die ${OWNER_TIER} bleibt bei dir.`,
      },
    },

    banList: {
      plural: BANS,
      search: `${BANS} suchen`,
      consequence: "Die Adresse kann sich nicht mehr anmelden und bekommt keine E-Mails.",
      duration: "Dauer",
      until: VALID_UNTIL,
      /**
       * A ban's line on a phone, whose box leaves its three columns out, in their order: the Grund, which says what it is,
       * then each date after its column's label, „Beleidigungen · Gültig bis Saison 2027 · Eingetragen am 12.11.2026“.
       */
      phoneLine: (reason: Words, until: Copy, day: CalendarDay) =>
        lineOf([textOf(reason), boundBy(VALID_UNTIL, until), boundBy(ENTERED_ON, formatDate(day))]),
      durationSaisons: (count: number) => (count === 1 ? "1\u00A0Saison" : boundBy(formatNumber(count), "Saisons")),
      /** The toast once the ban stands, by what did not follow it. */
      partial: {
        sessions: "Die Sperre steht, aber die Anmeldungen laufen weiter.",
        notice: "Die Sperre steht, aber die E-Mail ist nicht gesendet.",
        both: "Die Sperre steht, aber die Anmeldungen laufen weiter und die E-Mail ist nicht gesendet.",
        /** The second press's note, once it ended what the first left running. */
        ended: "Die Anmeldungen sind beendet.",
      },
      liftConsequence: "Die Adresse kann sich wieder anmelden.",
    },

    erasure: {
      /** The reason's box, a free text no check reads. */
      reference: "Referenz der Anfrage",
      object: "Daten",
      consequence: "Alles unter dieser Adresse wird endgültig gelöscht.",
      /** The rows a confirmation counts beyond the entries `shared` and `page` name. */
      count: {
        teamSeats: "Sitze in Teams",
        bewerbungSeats: "Sitze in Bewerbungen",
        spiele: "Eingeteilte Spiele",
      },
      /** The toast's note, the account undeleted or unknown: the form keeps the address, so its „Löschen“ retries. */
      partial: "Die Daten sind gelöscht, das Konto vielleicht nicht.",
    },

    withdrawal: {
      object: "Widerruf",
      choice: { name: NAME_ON_SITE, whatsapp: "WhatsApp", media: MEDIA } satisfies Record<FLWithdrawalChoice, string>,
      /** A fact's value: the kinds of record the entry ends one choice on. */
      ended: (kinds: readonly Copy[]) => formatList(kinds),
      /** What no press of the administration undoes: no administrative write grants a consent. */
      consequence: "Nur die Person kann wieder einwilligen.",
      noneChosen: "Kein Widerruf gewählt.",
      /** No record at the address grants a ticked choice, none at all included. */
      nothingGranted: "Unter dieser Adresse ist nichts davon erteilt.",
      entered: WITHDRAWAL_ENTERED,
    },

    addressChange: {
      waitsOn: { previous_address: "Bisherige offen", new_address: "Neue offen", waiting_period: "Wartezeit" } satisfies Record<
        FLAddressChangeWaitsOn,
        string
      >,
      /** A row's muted line, the moment its step ends: while a link is open, and in the wait. */
      until: (moment: string) => boundBy("bis", formatInstantShort(moment)),
      from: (moment: string) => boundBy("ab", formatInstantShort(moment)),
      /**
       * A stacked row's muted line, standing for the „Neu“ column a phone leaves out: „Neu: <address> · bis 12.11.,
       * 15:12“, the new address between the two parts, the moment after it where the step has one (`until`, `from`).
       */
      newLine: { before: `${AFTER}: `, after: (until: string) => ` · ${until}` },
      startConsequence: (wait: Wait) => `Die neue Adresse gilt erst ${waitWords(wait).span}, nachdem sie bestätigt ist.`,
      /** The typed address matching a listed row. */
      replaces: "Eine laufende Änderung wird ersetzt.",
    },

    /** Composed from the stored action. */
    actionLog: {
      /** The log's rows, apart from Konto's entries of the same word. */
      plural: "Einträge",
      search: "Einträge suchen",
      what: "Was",
      who: "Wer",
      when: "Wann",
      /** „Wer“'s option and value for a scheduled pass. */
      automatic: "Automatisch",
      time: {
        days: (count: number) => `Letzte ${boundBy(formatNumber(count), "Tage")}`,
      },
      actor: { contact: (team: Words) => `Kontaktperson · ${textOf(team)}`, contactNoTeam: "Kontaktperson" },
      /** A pass's label: one form, so a count of 1 needs no singular. */
      passCount: (noun: Copy, count: number) => `${noun}: ${formatNumber(count)}`,
      /** An admission's label: the address's other pending registrations it deleted, in `passCount`'s one form. */
      admittedOthers: (count: number) => `Weitere Registrierungen gelöscht: ${formatNumber(count)}`,
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
        "team.seat_objected": ENTRY_OBJECTED,
        "team.seat_einwilligung_withdrawn": WITHDRAWAL_ENTERED,
        "team.replaced": "Team ersetzt",
        "team.invitation_created": "Registrierungslink angelegt",
        "team.invitation_withdrawn": "Registrierungslink zurückgezogen",
        "bewerbung.accepted": "Bewerbung angenommen",
        "bewerbung.declined": "Bewerbung abgelehnt",
        "bewerbung.seat_changed": "Sitz geändert",
        "bewerbung.seat_objected": ENTRY_OBJECTED,
        "bewerbung.seat_einwilligung_withdrawn": WITHDRAWAL_ENTERED,
        "spieler.changed": "Spieler geändert",
        "spieler.deregistered": "Spieler ausgetragen",
        "spieler.reactivated": "Spieler reaktiviert",
        "spieler.einwilligung_withdrawn": WITHDRAWAL_ENTERED,
        "registrierung.admitted": "Spieler aufgenommen",
        "registrierung.declined": "Registrierung abgelehnt",
        "registrierung.einwilligung_withdrawn": WITHDRAWAL_ENTERED,
        "schiedsrichter.created": "Schiedsrichter angelegt",
        "schiedsrichter.changed": "Schiedsrichter geändert",
        "schiedsrichter.retired": "Schiedsrichter stillgelegt",
        "schiedsrichter.reactivated": "Schiedsrichter reaktiviert",
        "schiedsrichter.objected": ENTRY_OBJECTED,
        "schiedsrichter.einwilligung_withdrawn": WITHDRAWAL_ENTERED,
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
    saison: { days: "Tage", hours: "Stunden", minutes: "Minuten" },
  },

  /** The league's own name, which ends every tab title, and what an installed app calls itself. */
  brand: {
    name: "Frankfurt League",
    shortName: "FL",
    description:
      "Die Frankfurt League ist die Fußballliga der Frankfurter Oberstufen. Abi-Jahrgänge spielen 11\u00A0gegen\u00A011 um den Titel. Jedes Spiel bringt Geld für den Abiball.",
  },
});
