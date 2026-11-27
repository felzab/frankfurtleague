import {
  ACCOUNT_ERASED,
  ADDRESS_CHANGES,
  BEWERBUNGEN,
  boundBy,
  catalogue,
  DATE_OPEN,
  EFFECTIVE_FROM,
  GRANT,
  GRUPPE,
  K_O_RUNDE,
  KONTAKTPERSONEN,
  lineOf,
  LOCK,
  OWNER_TIER,
  REGISTRIERUNGEN,
  saisonNameBound,
  SCHIEDSRICHTER,
  searchLabel,
  spieleNamed,
  SPIELER,
  textOf,
  waitWords,
} from "../copy";
import { formatDate, formatInstantShort, formatList, formatNumber, formatPeriod } from "../format";
import { COPY } from "./shared";

import type { Copy, Wait, Words } from "../copy";
import type { CalendarDay } from "../format";
import type { Code, FLAction, FLAddressChangeWaitsOn, FLWithdrawalChoice } from "../generated/client/types";

const RETIREMENT = "Stilllegung";
const CONFIRMATIONS = "Bestätigungen";
const BANS = "Sperren";
const VALID_UNTIL = "Gültig bis";
const ENTERED_ON = "Eingetragen am";
const SINCE = "Seit";
// One word for every retention pass, its noun saying what it took.
const DELETED_BY_PASS = "Nach Frist gelöscht";
// One word for every person's objection through their own link, a seat's and a referee's alike: the act's question was
// „Eintrag widersprechen?“.
const ENTRY_OBJECTED = "Eintrag widersprochen";
// One word for every withdrawal an administrator entered from a person's mail, on any kind of record.
const WITHDRAWAL_ENTERED = "Widerruf eingetragen";
// One word for every address change started, one the administration starts for an address and a holder's own alike.
const ADDRESS_CHANGE_STARTED = "Adressänderung gestartet";
// One word for every seat an administrator changed, on a team's season and in an application alike.
const SEAT_CHANGED = "Sitz geändert";
const NAME_ON_SITE = "Name auf der Website";
const MEDIA = "Fotos und Videos";
const WHATSAPP = "WhatsApp";
const SENT_ON = "Gesendet am";
// A person's confirmation's day, as a player's fact labels it and a referee's Bestätigung states it.
const CONFIRMED_ON = "Bestätigt am";
const LOG_ENTRIES = "Einträge";
// The planning window's one lock over the draw's regeneration and its removal, by whether the season is still planned.
const PLANNING_WINDOW_SHUT = (planned: boolean) => (planned ? "Spiele sind schon bearbeitet" : "Gesperrt seit der Umstellung");

/** The administration's own words, which no page outside it reads. */
export const ADMIN_COPY = catalogue({
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
    /** The record as a danger box's sentence names it. */
    withArticle: "Der Spielort",
    search: COPY.shared.search(COPY.page.adminSpielorte),
    mietpreis: "Mietpreis",
    mietpreisExample: "60",
  },

  /**
   * Why a choice waits for the season's start: the team editor's exit, whose route before the start is the replacement,
   * and the match editor's events that record the match, offered disabled until then. In the lock line's own words, as
   * the match editor's line says the same lock above them.
   */
  untilStart: `Gesperrt ${LOCK.untilStart}`,
  /** „2 von 3“, a figure under its column's or its fact's name, where `SERVER_COPY.overview.seatsConfirmed` is a whole line. */
  seatsOf: (confirmed: number, seats: number) => `${formatNumber(confirmed)} von ${formatNumber(seats)}`,
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
  mailTo: {
    holders: "Alle Administratoren",
    holdersAndPerson: "Alle Administratoren und die Person",
    bothAddresses: "Beide Adressen",
  },
  retirement: RETIREMENT,
  /**
   * A danger box's consequence of retiring a record and of bringing it back, by the record as a noun phrase with its
   * article („Der Spielort“), and for retiring the records it is no longer picked for.
   */
  retireConsequence: (subject: Copy, what: Copy) => `${subject} steht für neue ${what} nicht mehr zur Auswahl.`,
  reactivateConsequence: (subject: Copy) => `${subject} steht wieder zur Auswahl.`,

  /**
   * What waits on two clubs while one is still open, in the form the season editor's other waits take: the swap and
   * the replacement until both their clubs are chosen, and a match's no-show until both its sides are known.
   */
  bothTeamsLocked: "Erst mit beiden Teams",

  schiedsrichter: {
    search: COPY.shared.search(COPY.page.adminSchiedsrichter),
    withArticle: "Die Person",
    kontaktData: "Kontaktdaten",
    confirmation: "Bestätigung",
    /** Where a confirmed entry's Bestätigung stands, by the day of its confirmation. */
    confirmedOn: (day: CalendarDay) => `${CONFIRMED_ON} ${formatDate(day)}`,
    sentTo: (address: string) => `An ${address} gesendet`,
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
    /**
     * By what its rows do, as the team's box is titled: the draw's regeneration and removal, the switch, or all three;
     * never „Spielplan“, which already titles the box of the draw's facts above it.
     */
    dangerBox: (draw: boolean, activation: boolean) =>
      draw && activation ? "Neuanlage, Löschung und Umstellung" : draw ? "Neuanlage und Löschung" : "Umstellung",

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
    recreateConsequence: "Alle Spieltage und Spiele werden gelöscht und neu angelegt.",
    deleteConsequence: "Alle Spieltage und Spiele werden gelöscht.",

    /** The replacement's two clubs: the one leaving the season, and the one taking over its row. */
    outgoing: "Ausscheidendes Team",
    incoming: "Nachrückendes Team",
    /** What the replacement does: the incoming club takes the outgoing one's group and every match of it. */
    replaceConsequence: (incoming: Words, outgoing: Words, gruppe: string) =>
      `${textOf(incoming)} übernimmt ${GRUPPE(gruppe)} und alle Spiele von ${textOf(outgoing)}.`,

    /**
     * Each team's registration link as its row states it, by what the press would do with it; a sent one's day also on
     * the links table's line on a phone, whose box leaves the „Gesendet am“ column out.
     */
    linkSentOn: (day: CalendarDay) => `${SENT_ON} ${formatDate(day)}`,
    sentOn: SENT_ON,
    noLinkYet: "Noch kein Link",
    noConfirmedAddress: "Keine bestätigte Adresse",
    addressBarred: "Adresse auf der Sperrliste",
    /** The rows say the rest. */
    sentTo: (count: number) => (count === 1 ? "An 1\u00A0Team gesendet" : `An ${boundBy(formatNumber(count), "Teams")} gesendet`),
    /** Why the send is locked: every team is passed over or already mailed, which its row says. */
    dispatchLocked: "Kein Link zu senden",
    dispatchConsequence: (count: number) =>
      count === 1 ? "1\u00A0Team bekommt seinen Link per E-Mail." : `${boundBy(formatNumber(count), "Teams")} bekommen ihren Link per E-Mail.`,

    /** The activation's subject, and the season the site shows from then on. */
    onto: (saison: string) => `Auf ${saisonNameBound(saison)}`,
    activateConsequence: (saison: string) => `Die Website zeigt ab sofort die ${saisonNameBound(saison)}.`,
    activateQuestion: "Die Website wechselt die Saison.",

    /**
     * Why a season's act is locked, as its tooltip says it, by the refusal its write would answer, which the read serves:
     * the activation while the season holds no draw or an undated matchday, or the season the site shows owes results;
     * the draw while a group holds more or fewer clubs than the rules give it, or a club stands in a group the rules do
     * not run; its regeneration or removal once reports stand, or once the planning window shuts, by whether the
     * season is still planned, a match of it holding something entered since the draw beyond its date, or went live;
     * and the list's create while a planned season stands, a league planning one season at a time.
     */
    locks: {
      activate_target_undrawn: "Erst mit Spielplan",
      activate_spieltage_undated: "Noch Spieltage ohne Datum",
      activate_saison_unfinished: "Erst mit allen Ergebnissen",
      spielplan_berichte_submitted: "Spielberichte liegen vor",
      spielplan_gruppen_off_rules: "Gruppen weichen von Regeln ab",
      spielplan_replace_outside_its_window: PLANNING_WINDOW_SHUT,
      spielplan_undraw_outside_its_window: PLANNING_WINDOW_SHUT,
      create_saison_future_stands: "Eine Saison ist schon geplant",
    } satisfies Partial<Record<Code, string | ((planned: boolean) => string)>>,
    /** A season's act locked by a refusal `locks` holds no phrase for, which only a page older than the API meets. */
    lockedOtherwise: "Zurzeit gesperrt",
  },

  spiel: {
    /** The editor of a match whose two teams are not both known yet, named by its number. */
    number: (nr: number) => spieleNamed([nr]),
    ansetzung: "Ansetzung",
    note: "Notiz",
    nichtantretenTeam1: "Nichtantreten Team 1",
    nichtantretenTeam2: "Nichtantreten Team 2",
    /** Where the write moved other matches too, by their numbers. */
    alsoChanged: (spiele: readonly number[]) => `Auch ${spieleNamed(spiele)} geändert`,

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
        ? `Das Ergebnis von ${spieleNamed(spiele)} wird gelöscht.`
        : `Die Ergebnisse von ${spieleNamed(spiele)} werden gelöscht.`,
  },

  bewerbung: {
    search: COPY.shared.search(COPY.page.adminBewerbungen),
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
    cardOf: (position: number, total: number) => `Bewerbung ${formatNumber(position)} von ${formatNumber(total)}`,
    count: (count: number) => (count === 1 ? "1\u00A0Bewerbung" : boundBy(formatNumber(count), "Bewerbungen")),
    acceptManyConsequence: (saison: string) => `Die Teams werden endgültig Teil der ${saisonNameBound(saison)}.`,
    /** „E-Mail an“'s value in the bulk's question. An application names at least two people, so the count is never 1. */
    kontaktCount: (count: number) => boundBy(formatNumber(count), "Kontaktpersonen"),
    shorthandTaken: "Kürzel vergeben",
    acceptedCount: (count: number) =>
      count === 1 ? "1\u00A0Bewerbung angenommen" : `${boundBy(formatNumber(count), "Bewerbungen")} angenommen`,
    acceptedOn: "Angenommen am",
    declinedOn: "Abgelehnt am",
  },

  team: {
    search: COPY.shared.search(COPY.page.teams),
    withArticle: "Das Team",
    /** The state filter's default, the season's clubs, where its option „Stillgelegt“ reads past them to every retired club. */
    ofSaison: "Alle Teams der Saison",
    gruppeFull: "Voll",
    /** „Team eintragen“'s reason while locked, and „Annehmen“'s in a running or finished season: either enters a club. */
    onlyPlanned: "Nur in einer geplanten Saison",
    enterDescription: "Ein bekanntes Team oder eine neue Schule",
    inSaison: (saison: string) => `In der ${saisonNameBound(saison)}`,
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
    austrittAct: "Austritt eintragen",
    /** What the exit row is for; what the exit ends, `austrittLine` says under the dialog's date. */
    austrittRowLine: "Das Team scheidet aus der Saison aus.",
    austrittReasonDescription: "Steht ohne Namen auf der Website",
    /**
     * Under the exit's date: the write calls no fixture off, so the line says only what it ends, the club's requests,
     * and that its seats lose the line-up's page and its reminders, so the league alone enters a line-up from then.
     */
    austrittLine: "Offene Anfragen zu Spielen ab diesem Tag enden, Aufstellungen trägt die Liga ein.",
    retireLocked: "Team spielt noch eine Saison",
  },

  /**
   * A person's consent answers as facts, a pupil's, a referee's and a contact seat's alike, each choice by its name: the
   * name's answer in the words of the option chosen, WhatsApp's and the photographs' as yes or no.
   */
  einwilligung: {
    nameOnSite: NAME_ON_SITE,
    whatsapp: WHATSAPP,
    media: MEDIA,
    yes: "Ja",
    no: "Nein",
  },

  spieler: {
    person: "Person",
    deregisteredOn: "Ausgetragen am",
    einwilligung: "Einwilligung",
    givenOn: "Erteilt am",
    confirmedOn: CONFIRMED_ON,
    kaderEntry: "Kadereintrag",
    reactivateConsequence: "Die Person steht wieder im Kader.",
  },

  administrators: {
    object: "Administrator",
    /** The column holding each row's tier, „Leitung“ or „Verwaltung“: which access the address holds. */
    tier: GRANT,
    pending: "Angekündigt",
    since: SINCE,
    pendingKind: { addition: "Neuer Administrator", handover: `Übergabe der ${OWNER_TIER}` },
    /** A waiting row's one muted line: what waits, a new address where one does, and its date. */
    pendingLine: (kind: Copy, address: string | null, moment: string) =>
      lineOf([kind, address, `${EFFECTIVE_FROM} ${formatInstantShort(moment)}`]),
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
    search: searchLabel(BANS),
    /** After the ban's own notice, which `mailTo` names: the ban bars the hand-out of every later mail. */
    consequence: "Die Adresse kann sich nicht mehr anmelden und bekommt danach keine E-Mails.",
    /** „E-Mail an“'s value: the notice goes only where an account stands, which the press reads once the address is typed. */
    mailTo: "Die Adresse, falls sie ein Konto hat",
    duration: "Dauer",
    until: VALID_UNTIL,
    durationSaisons: (count: number) => (count === 1 ? "1\u00A0Saison" : boundBy(formatNumber(count), "Saisons")),
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
    choice: { name: NAME_ON_SITE, whatsapp: WHATSAPP, media: MEDIA } satisfies Record<FLWithdrawalChoice, string>,
    /** A fact's value: the kinds of record the entry ends one choice on. */
    ended: (kinds: readonly Copy[]) => formatList(kinds),
    /** What no press of the administration undoes: no administrative write grants a consent. */
    consequence: "Nur die Person kann wieder einwilligen.",
    noneChosen: "Kein Widerruf gewählt.",
    /** No record at the address grants a ticked choice, none at all included. */
    nothingGranted: "Unter dieser Adresse ist nichts davon erteilt.",
  },

  addressChange: {
    waitsOn: { previous_address: "Bisherige offen", new_address: "Neue offen", waiting_period: "Wartezeit" } satisfies Record<
      FLAddressChangeWaitsOn,
      string
    >,
    /** A row's muted line, the moment its step ends: while a link is open, and in the wait. */
    until: (moment: string) => `bis ${formatInstantShort(moment)}`,
    from: (moment: string) => `ab ${formatInstantShort(moment)}`,
    startConsequence: (wait: Wait) => `Die neue Adresse gilt erst ${waitWords(wait).span}, nachdem sie bestätigt ist.`,
    /** The typed address matching a listed row. */
    replaces: "Eine laufende Änderung wird ersetzt.",
  },

  /** Composed from the stored action. */
  actionLog: {
    /** The log's rows, apart from Konto's entries of the same word. */
    plural: LOG_ENTRIES,
    search: searchLabel(LOG_ENTRIES),
    what: "Was",
    who: "Wer",
    when: "Wann",
    /** „Wer“'s option and value for a scheduled pass. */
    automatic: "Automatisch",
    time: {
      days: (count: number) => `Letzte ${boundBy(formatNumber(count), "Tage")}`,
    },
    actor: { contact: (team: Words) => lineOf(["Kontaktperson", textOf(team)]), contactNoTeam: "Kontaktperson" },
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
      "team.seat_changed": SEAT_CHANGED,
      "team.seat_objected": ENTRY_OBJECTED,
      "team.seat_einwilligung_withdrawn": WITHDRAWAL_ENTERED,
      "team.replaced": "Team ersetzt",
      "team.invitation_created": "Registrierungslink angelegt",
      "team.invitation_withdrawn": "Registrierungslink zurückgezogen",
      "bewerbung.accepted": "Bewerbung angenommen",
      "bewerbung.declined": "Bewerbung abgelehnt",
      "bewerbung.seat_changed": SEAT_CHANGED,
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
      "grant.address_change_started": ADDRESS_CHANGE_STARTED,
      "grant.address_switched": "Adresse gewechselt",
      "ban.added": "Sperre eingetragen",
      "ban.removed": "Sperre entfernt",
      "address_change.started": ADDRESS_CHANGE_STARTED,
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
});
