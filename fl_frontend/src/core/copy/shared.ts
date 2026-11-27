import {
  ADDRESS_CHANGES,
  AFTER,
  BEWERBUNGEN,
  boundBy,
  catalogue,
  DATE_OPEN,
  EFFECTIVE_FROM,
  GRANT,
  GRUPPE,
  K_O_RUNDE,
  KONTAKT_SEAT_LONG_FORM,
  KONTAKTPERSONEN,
  lineOf,
  LOCK,
  OWNER_TIER,
  PRIVACY_NOTICE,
  REGISTRIERUNGEN,
  saisonName,
  saisonNameBound,
  SCHIEDSRICHTER,
  searchLabel,
  seatsText,
  spieleNamed,
  SPIELER,
  spieltagName,
  textOf,
  VERB,
} from "../copy";
import {
  formatDate,
  formatDateLong,
  formatDateWithWeekday,
  formatErgebnis,
  formatList,
  formatNumber,
  formatOrdinal,
  formatTime,
} from "../format";

import type { Copy, LockReason, Verb, Words } from "../copy";
import type { CalendarDay, Pair, TimeOfDay } from "../format";
import type {
  FLActionLogPageSize,
  FLAustrittType,
  FLKontaktSeat,
  FLSaisonPhase,
  FLSchulform,
  FLSpielerRolle,
  FLSpielSide,
  FLTrikotFarbe,
} from "../generated/client/types";

const infinitive = (verb: Verb): string => `${VERB[verb].charAt(0).toLowerCase()}${VERB[verb].slice(1)}`;
// The mark beside a score a shoot-out decided, its two parts joined by a no-break space so a narrow row never parts them.
const AFTER_ELFMETERSCHIESSEN = "n.\u00A0E.";
const SIGN_IN = "Anmeldung";
const KADER = "Kader";
const ENTRY = "Eintrag";
const startelfCount = (count: number, max: number) => `Startelf ${formatNumber(count)} von ${formatNumber(max)}`;
const DELETED = "Gelöscht";
// Words a record's state, a form's line or a toast shares with a done act's toast, kept as one string each.
const SAVED = "Gespeichert";
const RETIRED = "Stillgelegt";
const SENT = "Gesendet";
const DECLINED = "Abgelehnt";
const DEREGISTERED = "Ausgetragen";
const FILTER = "Filter";

/**
 * The words every audience reads: the kit's, the shared section's, the route titles' and the records' noun sections. It
 * keeps the catalogue's name, `COPY`, since nearly every module reads it.
 */
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
      without: (thing: Copy) => `Ohne ${thing}`,
      earliest: (day: CalendarDay) => `Frühestens ${formatDate(day)}`,
      latest: (day: CalendarDay) => `Spätestens ${formatDate(day)}`,
      taken: "Schon vergeben",
    },

    /**
     * The lines a refusal the catalogue does not word reads, and every failure that is no refusal
     * (`core/action.ts :: refused`).
     */
    failure: {
      unexpected: "Etwas ist schiefgelaufen",
      stale: "Die Seite ist nicht mehr aktuell.",
      signInExpired: "Deine Anmeldung ist abgelaufen.",
      /** A press past any limit on tries, whatever was counted: the edge's rate, a code's wrong tries, an address's codes. */
      tooManyAttempts: "Zu viele Versuche",
      /** An administrator's grant is gone or was never held: no sign-in and no retry repairs it. */
      accessGone: "Dein Zugang zur Verwaltung besteht nicht mehr.",
    },
    /**
     * An act the passkey touch guards that its passkey did not answer for: refused in the browser's prompt, or sent
     * without a passkey sign-in of the last minute by an administrator.
     */
    touchMissing: "Die Freigabe mit deinem Passkey fehlt.",

    saved: SAVED,
    retired: RETIRED,

    state: {
      active: "Aktiv",
      confirmed: "Bestätigt",
      unconfirmed: "Unbestätigt",
      objected: "Widersprochen",
      erased: DELETED,
      expired: "Abgelaufen",
      agreed: "Zugesagt",
      /** A club's decline and a referee's alike; a match called off reads as its event, „Ausgefallen“. */
      declined: DECLINED,
      nominee: "Nachnominiert",
      linkSent: SENT,
      linkNotSent: "Nicht gesendet",
    },
    expiredOn: (day: CalendarDay) => `Abgelaufen am ${formatDate(day)}`,
    answerBy: (day: CalendarDay) => `Antwort bis ${formatDate(day)}`,
    /** The day a state took effect, beside the chip naming the state: „am 09.11.2026“. */
    onDay: (day: CalendarDay) => `am ${formatDate(day)}`,
    afterConfirmation: "Erst nach Bestätigung",
    afterHandover: `Erst nach Übergabe der ${OWNER_TIER}`,
    reason: "Grund",
    /** The description of a free text a mail hands to people it may not concern. */
    noNames: "Ohne Namen",
    mediaFrom: (age: number) => `Erst ab ${boundBy(formatNumber(age), "Jahren")}`,

    administration: "Verwaltung",
    owner: OWNER_TIER,
    payment: "Honorar",

    emailAddress: "E-Mail-Adresse",
    /** An address holding no record, on an erasure's question and an address change's start, Konto's and the administration's. */
    nothingAtAddress: "Unter dieser Adresse steht nichts.",
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
      // A venue or a school without a house number stores it blank, which leaves no space before the line's comma.
      streetWithHouseNumber: (street: string, houseNumber: string) => (houseNumber === "" ? street : `${street} ${houseNumber}`),
      addressLine: (street: Copy, postcode: string, city: string) => `${street}, ${postcode} ${city}`,
    },

    /** The toast titles; a toast carries no body. */
    toast: {
      copied: "Kopiert",
      linkSent: "Link gesendet",
      othersSignedOut: "Alle anderen abgemeldet",
      /**
       * A done act, by its verb, where its answer brings no note of its own: a closed question's or dialog's, a section
       * act's, a box's. A handover only starts its wait, as its row under „Angekündigt“ says.
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
        replace: "Ersetzt",
        swap: "Getauscht",
        create: "Angelegt",
        reactivate: "Reaktiviert",
        deregister: DEREGISTERED,
        adopt: "Übernommen",
        save: SAVED,
        retire: RETIRED,
        admit: "Aufgenommen",
        send: SENT,
        decline: DECLINED,
        accept: "Angenommen",
        set: "Gesetzt",
        rename: "Umbenannt",
        setUp: "Eingerichtet",
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
      /**
       * A closed record's list holding none, a finished season's report naming no card: none is to come, where `none`
       * would say one still is.
       */
      unrecorded: (plural: Copy) => `Keine ${plural} eingetragen.`,
    },
    /** A list's search box, by the list's plural. */
    search: (plural: Copy) => searchLabel(plural),
    /**
     * What a screen reader hears once a searched list's typed text settles: „Treffer“ is one noun for any list's rows
     * in the singular and the plural, and a search finding none says `empty.search`.
     */
    searchCount: (count: number) => `${boundBy(formatNumber(count), "Treffer")} für diese Suche.`,

    /** „Passkey löschen?“: a confirmation asks with the verb its button carries. */
    question: (object: Copy, verb: Verb) => `${object} ${infinitive(verb)}?`,
    back: "Zurück",
    close: "Schließen",

    end: {
      doneOn: (done: Copy, day: CalendarDay) => `${done} am ${formatDateLong(day)}`,
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
    austrittSince: (state: Copy, day: CalendarDay) => `${state} seit ${formatDate(day)}`,
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
    erasureCount: { addressChanges: "Laufende Adressänderungen", grant: GRANT },
    spieler: SPIELER,
    schiedsrichter: SCHIEDSRICHTER,
    /** The schools a picker lists, the plural its empty search names, and the landing's count of them. */
    schulen: "Schulen",
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
      /**
       * A screen reader's words for the bar at a qualifying row's edge, by its tone, which the eye reads from its
       * colour: a place the row holds alone reaches the K.-o.-Runde only as the table stands now, and the bracket
       * seeds no club of a shared one.
       */
      qualifies: { settled: `Reicht derzeit für die ${K_O_RUNDE}`, level: "Geteilter Platz" },
    },

    help: "Hilfe",
    /** A combo box's button opening its list, whether or not the box takes free text. */
    showSuggestions: "Vorschläge anzeigen",
    filter: FILTER,
    /** The phone's filter button once filters are chosen; with none chosen it reads `filter`. */
    filterCount: (count: number) => `${FILTER} (${formatNumber(count)})`,
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
    botCheck: "Die Prüfung, dass du ein Mensch bist, fehlt.",
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
    signIn: VERB.signIn,
    accountSignIn: SIGN_IN,
    accountSecurity: "Sicherheit",
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
    addressChangeConfirmation: "E-Mail-Adresse ändern",
    entryConfirmation: `${ENTRY} ${infinitive("confirm")}`,
    registrierungConfirmation: "Registrierung bestätigen",
    accountErasure: "Konto löschen",
    registrierung: "Registrierung",
    bewerbung: (saison: string) => `Bewerbung ${saisonName(saison)}`,
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
      day === null ? DATE_OPEN : time === null ? formatDateWithWeekday(day) : lineOf([formatDateWithWeekday(day), formatTime(time)]),

    /** A side the draw has not settled: its source short in the dashed plaque, and in full as its name. */
    quelle: {
      gruppeShort: (gruppe: string, platz: number) => `${gruppe}${formatNumber(platz)}`,
      gruppe: (gruppe: string, platz: number) => `${formatOrdinal(platz)} der Gruppe ${gruppe}`,
      siegerShort: (spiel: number) => `S${formatNumber(spiel)}`,
      sieger: (spiel: number) => `Sieger von ${spieleNamed([spiel])}`,
      verliererShort: (spiel: number) => `V${formatNumber(spiel)}`,
      verlierer: (spiel: number) => `Verlierer von ${spieleNamed([spiel])}`,
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
        nichtantreten: (opponent: Words) => `Das Spiel wird für ${textOf(opponent)} gewertet.`,
        abgebrochenScored: "Das eingetragene Ergebnis wird gewertet.",
        abgebrochenOpen: "Die Wertung steht noch nicht fest.",
      },
    },

    fact: {
      spieltag: "Spieltag",
      date: "Datum",
      time: "Uhrzeit",
      spielort: "Spielort",
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
    preview: (pairing: Copy, when: Copy, result: Copy) => lineOf([pairing, when, result]),

    answer: "Antwort",
    appointment: "Termin",
    vorschlag: "Vorschlag",
    proposed: (when: Copy) => `Vorschlag ${when}`,
    /** The administrator's note on a Zusage they enter for a party, how it reached the league; a decline's is `shared.reason`. */
    answerNote: "Begründung",
    enteredByLeague: "Von der Verwaltung eingetragen",
  },

  /** A squad row's fields, one word each wherever a person meets them. */
  kader: {
    search: searchLabel(SPIELER),
    nummer: "Nummer",
    position: "Position",
    stufe: "Stufe",
    rolle: "Rolle",
    rolleOption: { kapitaen: "Kapitän", co_kapitaen: "Co-Kapitän" } satisfies Record<FLSpielerRolle, string>,
    deregistered: DEREGISTERED,
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
    counts: (picked: number, starting: number, max: number) => lineOf([`${formatNumber(picked)} aufgestellt`, startelfCount(starting, max)]),
    rest: "Nicht aufgestellt",
    /**
     * Why „Aufstellen“ is locked on a nominee's row once the line-up names `max` of the squad's own players, a nominee
     * filling a shortage alone: the bound the backend publishes, never a typed figure.
     */
    nomineeLocked: (max: number) => `Nur bei weniger als ${formatNumber(max)}`,
    dueBy: (day: CalendarDay) => `Aufstellung bis ${formatDate(day)}`,
    /** Beside the „Überfällig“ chip, a whole phrase still: „seit“ with the noun alone would say the line-up stands. */
    overdueSince: (day: CalendarDay) => `Aufstellung seit ${formatDate(day)} überfällig`,
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
    /** The menu's landmark name, which a screen reader says after the role, so it never repeats „Navigation“. */
    navigation: "Hauptmenü",
    /** The account's place, one word signed in and out alike. */
    account: "Konto",
    menu: "Menü",
    /**
     * The theme control's name, and its three choices in the order the control shows them, the third following the
     * device's own setting.
     */
    theme: { label: "Darstellung", dark: "Dunkel", light: "Hell", system: "System" },
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
    /** A save refused for its fields: the fields say what, the status line that some are off. */
    checkFields: "Einige Felder sind nicht richtig ausgefüllt.",
    open: "Offen",

    /** A page a mail opened whose link no longer holds: one title for an expired, mistyped or tampered link alike. */
    linkInvalid: "Link nicht mehr gültig",
  },

  /** The league's own name, which ends every tab title, and what an installed app calls itself. */
  brand: {
    name: "Frankfurt League",
    shortName: "FL",
    description:
      "Die Frankfurt League ist die Fußballliga der Frankfurter Oberstufen. Abi-Jahrgänge spielen 11 gegen 11 um den Titel. Jedes Spiel bringt Geld für den Abiball.",
  },
});
