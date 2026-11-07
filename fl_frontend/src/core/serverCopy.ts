import "server-only";

import { KONTAKT_EMAIL, VEREIN_ADDRESS, VEREIN_NAME, VEREINSREGISTER, VORSTAND_JOINTLY } from "./brand";
import { catalogue, COPY, textOf, waitWords } from "./copy";
import { formatDate, formatDateLong, formatInstant, formatList, formatNumber, formatOrdinal, formatSigned } from "./format";
import { rollenText } from "./teamVocabulary";

import type { Copy, Wait, Words } from "./copy";
import type { CalendarDay } from "./format";
import type { Code, FLBookingResource, FLKontaktRolle, FLOverviewCardName, FLRefusedField, Rule } from "./generated/client/types";
import type { ROUTES } from "./routes";

/** The route keys of the pages a search engine may list. */
type ListedRoute = { [Key in keyof typeof ROUTES]: (typeof ROUTES)[Key]["crawl"] extends "index" ? Key : never }[keyof typeof ROUTES];

const { team1, team2 } = COPY.admin.spiel;
const ownerTier = COPY.admin.administrators.owner;

// Words two entries of this one object say alike, each written once: a club's place, a group, the goals' difference
// and match operations, the season line's eyebrow and an organiser's role.
const PLATZ = "Platz";
const TEAM = "Team";
const DIFFERENZ = "Diff.";
const SPIELBETRIEB = "Spielbetrieb";
const gruppeName = COPY.shared.season.gruppe;
const placeName = (platz: number) => `${formatOrdinal(platz)} ${PLATZ}`;
// Matches by their numbers, „Spiel 4, 7 und 9“, as the match editor's done line names the others it changed.
const spieleNamed = (nrs: readonly number[]) => `Spiel ${formatList(nrs.map(formatNumber))}`;
// A fixture's ground or referee booked at its time elsewhere, and a side out of the season: the save keys each by the
// path it names, the adoption, which names none, by a code of its own per resource and side.
const DOUBLE_BOOKED = {
  spielort: "Der Spielort ist zu dieser Zeit schon belegt.",
  schiedsrichter: "Die eingeteilte Person pfeift zu dieser Zeit schon.",
};
const DISQUALIFIED = {
  team1: `${team1} ist aus der Saison ausgeschieden.`,
  team2: `${team2} ist aus der Saison ausgeschieden.`,
};
// An address the ban list holds, whichever write would mail it a link.
const ADDRESS_BARRED = "Diese E-Mail-Adresse steht auf der Sperrliste.";
// An address the administration holds, whichever act reached for it: a ban, an erasure or an address change.
const ADDRESS_OF_ADMINISTRATION = "Diese Adresse gehört zur Verwaltung.";
// The new address's answer, the title of its done page, a waiting change's opening on that title.
const ADDRESS_CONFIRMED = "Adresse bestätigt";

// The confirmation pages' shared sentences, each written once: what the typed birthdate is checked for, the deadline
// of an entry that goes alone, the objection Art. 21 (4) asks to be named explicitly, in the two parts around the
// league's address, and the privacy notice's link, around its title.
const ageCheck = (minAge: number) => `Mit deinem Geburtsdatum prüfen wir, ob du mindestens ${formatNumber(minAge)} Jahre alt bist.`;
// In the two parts around its day, which a mail sets semibold between them.
const ENTRY_DEADLINE = { before: "Bestätigst du nicht bis zum", after: ", löschen wir deinen Eintrag." };
const entryDeadline = (until: CalendarDay) => `${ENTRY_DEADLINE.before} ${formatDateLong(until)}${ENTRY_DEADLINE.after}`;
// The same in an application, where any seat's lapse takes the whole application with it, so the deletion names no day:
// another seat's earlier day can overtake the reader's own.
const APPLICATION_DEADLINE = {
  before: "Bestätige bis zum",
  after: ". Bestätigt eine Kontaktperson nicht rechtzeitig, löschen wir die Bewerbung.",
};
const applicationDeadline = (until: CalendarDay) => `${APPLICATION_DEADLINE.before} ${formatDateLong(until)}${APPLICATION_DEADLINE.after}`;
const OBJECTION_RIGHT = {
  before:
    "Du kannst der Verarbeitung deiner Angaben jederzeit widersprechen, aus Gründen, die sich aus deiner besonderen Situation ergeben (Art. 21 DSGVO). Eine formlose E-Mail an ",
  after: " genügt.",
};
const MORE = { before: "Mehr unter ", after: "." };
// What an objection does to a contact's seat on a season row, an entry that stands alone.
const OBJECTION_DELETES_ENTRY = "Widersprichst du, löschen wir deinen Eintrag.";
// A referee's confirmation's opening, which its mail opens on too, and what the league stores of the entry.
const REFEREE_OPENING = "Die Liga hat dich als Schiedsrichterin oder Schiedsrichter für ihre Spiele eingetragen.";
const REFEREE_STORED =
  "Wir speichern deinen Namen, deine Kontaktdaten, dein Honorar, dein Geburtsdatum und deine Schule, wenn sie angegeben ist, bis du oder die Liga den Eintrag beenden.";

/**
 * The bounds the frontend's code holds that the privacy notice's retention table states, passed by its page. An hour
 * read „1 Stunde“ is typed as its one figure, the singular being the sentence's.
 */
type RetentionBounds = {
  bewerbungDays: number;
  schiedsrichterDays: number;
  addressChangeLinkHours: number;
  code: { minutes: number; mailHours: 1; failureHours: number };
  person: { idleDays: number; days: number };
  admin: { idleHours: 1; hours: number };
};

/**
 * The catalogue's entries only the server reads, so no client bundle carries them: `COPY` is one object, and a
 * bundler keeps all of an object a client module imports. Branded as `COPY` is, so an entry passes wherever a `Copy`
 * is asked for.
 */
export const SERVER_COPY = catalogue({
  /**
   * A refusal's phrase under the field it is about, by the backend's code, for a code a person causes knowingly from
   * a screen: one of `COPY.shared.field`'s patterns, and nothing else. A code whose phrase names a bound its refusal
   * carries is worded from it by `fl_frontend/src/core/ruleMessage.ts :: ruleMessage` instead, and a code no pattern
   * words takes `refusalLine`'s sentence; every other code answers one of the shared failure lines
   * `COPY.shared.failure` holds.
   */
  refusal: {
    duplicate_key: COPY.shared.field.taken,
    // One rule over two codes: a match whose result no play decides carries no goals, on the fixture and in its report.
    state_ergebnis_on_a_non_event: COPY.shared.field.without(COPY.shared.tore),
    // A rule of their own rather than a unique index: a seat of an application or a season row, and a squad's one Kapitän per team.
    bewerbung_kontakt_email_taken: COPY.shared.field.taken,
    bewerbung_kontakt_phone_taken: COPY.shared.field.taken,
    bewerbung_kontakt_repeated: COPY.shared.field.taken,
    trikot_farbe_taken: COPY.shared.field.taken,
    kontakt_email_taken: COPY.shared.field.taken,
    kontakt_phone_taken: COPY.shared.field.taken,
    kader_rolle_taken: COPY.shared.field.taken,
    grant_exists: COPY.shared.field.taken,
    // The address tool's new address: another pupil signs in on it, or an entry names it.
    address_change_taken: COPY.shared.field.taken,
    address_change_occupied: COPY.shared.field.taken,
  } satisfies Partial<Record<Code, string>>,

  /**
   * A refusal's sentence on the status line, by the backend's code, for a code a person causes knowingly from a
   * screen that no field pattern words: the write as a whole, or a field the sentence names itself. Where one code
   * is about one of several fields, its sentence is keyed by the first name of the path the backend names, so it
   * says which; a path it holds no sentence for is not this screen's to word. A sentence naming the bounds its
   * refusal carries is a function of them, answering `undefined` where one it names is missing.
   */
  refusalLine: {
    saison_past: "Diese Saison ist abgeschlossen.",
    spiel_outside_spieltag: "Dieses Datum liegt außerhalb des Spieltags.",
    state_nichtantreten_without_two_sides: "Beide Teams stehen noch nicht fest.",
    /**
     * A retired venue or referee a fixture keeps where its save reopens it, which the editor shows marked: a deleted one
     * is a page read before the deletion, which the same sentence sends to the same box.
     */
    booking_unknown_resource: {
      spielort: "Der Spielort ist stillgelegt.",
      schiedsrichter: "Die eingeteilte Person ist stillgelegt.",
    },
    spiel_double_booked: DOUBLE_BOOKED,
    spiel_double_booked_spielort_as_stored: DOUBLE_BOOKED.spielort,
    spiel_double_booked_schiedsrichter_as_stored: DOUBLE_BOOKED.schiedsrichter,
    /** The owner's own deletion, on `/erasure` and in Konto: the handover frees the account first. */
    owner_erasure: `Mit der ${ownerTier} lässt sich das Konto nicht löschen.`,
    /** An administrator's own address, which only Konto changes or deletes. */
    own_address: "Für deine eigene Adresse geht das nur im Konto.",
    /** A holder's address, one sentence on a ban, an erasure and an address change alike. */
    admin_address: ADDRESS_OF_ADMINISTRATION,
    ban_list_admin: ADDRESS_OF_ADMINISTRATION,
    foreign_address_change: ADDRESS_OF_ADMINISTRATION,
    /** A ban's last season counts from the running one. */
    ban_list_no_saison: "Es läuft keine Saison.",
    /** The address on file typed again, on Konto's start and on the address tool's alike, so it names nobody's. */
    address_change_unchanged: "Diese Adresse ist schon hinterlegt.",
    /** An address change's start, for an address holding no record. */
    address_change_nothing: COPY.admin.nothingAtAddress,
    /** The re-send's own, which holds no box to set the field's phrase on. */
    address_change_new_taken: "Die neue Adresse ist schon vergeben.",
    /** A person's own start pressed again too soon after the last mail its change owed: the edge's own rate refusal. */
    address_change_started_recently: COPY.shared.failure.tooManyAttempts,
    /** A venue retired while matches still to come are booked there, named by their numbers so they can be moved first. */
    spielort_still_booked: ({ spiel_nrs }: FLRefusedField["ctx"]) =>
      Array.isArray(spiel_nrs) && spiel_nrs.length > 0 ? `Der Spielort ist noch für ${spieleNamed(spiel_nrs)} gebucht.` : undefined,
    /** A referee retired while matches still to come name them, by the matches' numbers. */
    schiedsrichter_still_assigned: ({ spiel_nrs }: FLRefusedField["ctx"]) =>
      Array.isArray(spiel_nrs) && spiel_nrs.length > 0 ? `Die Person ist noch für ${spieleNamed(spiel_nrs)} eingeteilt.` : undefined,
    /** An addition or a handover naming an address the ban list holds. */
    grant_barred: ADDRESS_BARRED,
    /** A club the form or the acceptance picked that already stands in the season. */
    bewerbung_picked_team_already_entered: "Diese Schule spielt in dieser Saison schon mit.",
    /** A repeated press of the form's submit with changed details. */
    bewerbung_key_differing: "Deine Bewerbung ist schon abgeschickt.",
    /** An application's club retired since the acceptance opened. */
    team_retired: "Das Team ist stillgelegt.",
    /** A reactivated squad row past the season's cap. */
    kader_full: "Der Kader ist voll.",
    /** A club's stored proposed day that has gone by, which „Übernehmen“ would move the fixture into. */
    ansetzung_vorschlag_past_as_stored: "Der vorgeschlagene Tag ist vorbei.",
    // A season's rules and its activation, each a fact the person reads off the season editor itself.
    rules_bracket_impossible: COPY.admin.saison.bracketImpossible,
    rules_spiele_over_one_read: COPY.admin.saison.tooManySpiele,
    spielplan_gruppen_off_rules: COPY.admin.saison.gruppenOffRules,
    activate_target_undrawn: COPY.admin.saison.noDraw,
    activate_saison_unfinished: COPY.admin.saison.unfinished,
    activate_spieltage_undated: COPY.admin.saison.undated,
    create_saison_future_stands: COPY.admin.saison.futureStands,
    eligibility_disqualified: DISQUALIFIED,
    eligibility_disqualified_team1_as_stored: DISQUALIFIED.team1,
    eligibility_disqualified_team2_as_stored: DISQUALIFIED.team2,
    /**
     * A save after which the bracket would field one club in two matches of one matchday, a club picked by hand
     * standing where the bracket's own wiring leads it too: the same save answers the same, the page being current.
     */
    spieltag_occupied_by_the_resolution: "Ein Team spielt dann zweimal an diesem Spieltag.",
    /**
     * A fixture's save, the match editor's or „Übernehmen“'s, that would delete a later result it was not confirmed
     * to delete, one entered or changed since the question was asked among them: the match editor asks again.
     */
    voided_results_stale: COPY.admin.overview.voidsLater,
    /** A matchday's dates: past its season's, short of one of its dated matches, or out of its phase's order of matchdays. */
    spieltag_outside_saison: "Dieser Zeitraum liegt außerhalb der Saison.",
    spieltag_span_below_spiele: "Ein Spiel liegt außerhalb dieses Zeitraums.",
    spieltag_start_out_of_order: "Der Beginn passt nicht in die Reihenfolge der Spieltage.",
  } satisfies Partial<Record<Code, string | Readonly<Record<string, string>> | ((context: FLRefusedField["ctx"]) => string | undefined)>>,

  /**
   * A rule's sentence on the status line, by the kind the backend refuses a payload with (`fields[].kind`), for a
   * rule a person can break that no field pattern words: placed as `refusalLine` places a code. Every rule a pattern
   * words is worded by `fl_frontend/src/core/ruleMessage.ts :: ruleMessage`.
   */
  ruleLine: {
    elfmeterschiessen_without_winner: "Das Elfmeterschießen hat keinen Sieger.",
    elfmeterschiessen_without_draw: "Das Ergebnis ist kein Unentschieden.",
    scorers_not_matching_tore: "Die Torschützen passen nicht zum Ergebnis.",
  } satisfies Partial<Record<Rule, string>>,

  /** The image a shared link's preview shows, by its alt, which a screen reader reads in the preview's place. */
  shareImage: {
    alt: `${COPY.brand.name}, die Fußballliga der Frankfurter Oberstufen: der Pokal über dem Schriftzug`,
  },

  /**
   * The administrator's Übersicht: its four cards by the names the read serves them under, and each row's one line
   * saying what is open there, by the kind of open work.
   */
  overview: {
    card: {
      due: "Heute und überfällig",
      ergebnisse: "Ergebnisse",
      dates: "Termine",
      bewerbungen: COPY.page.adminBewerbungen,
    } satisfies Record<FLOverviewCardName, string>,
    answerDue: "Antwort heute fällig",
    /** By the deadline the clubs' answer was due on, the earliest where the row's clubs were given several. */
    answerOverdue: (deadline: CalendarDay) => `Antwort seit ${formatDate(deadline)} überfällig`,
    /** What a fixture lacks, by its own word: „Termin“, or the label its box carries in the match editor. */
    missing: (label: Copy) => `${label} fehlt`,
    /** A report awaiting the administrator, by the state it reads in. */
    report: {
      proposed: "Spielbericht nicht übernommen",
      differing: "Spielbericht weicht vom Ergebnis ab",
      sides_changed: "Spielbericht nennt andere Teams",
    },
    /** A club's proposed date and hour, as a match row writes them; a club the fixture no longer fields is not named. */
    proposal: (when: Copy, team: Words | null) => (team === null ? `Schlägt ${when} vor` : `${textOf(team)} schlägt ${when} vor`),
    /** An application, by how many of its contact seats have confirmed their entry. */
    seatsConfirmed: (confirmed: number, seats: number) =>
      confirmed === seats
        ? "Alle Kontaktpersonen bestätigt"
        : `${formatNumber(confirmed)} von ${formatNumber(seats)} Kontaktpersonen bestätigt`,
    /**
     * A fault of the bracket or of a fixture's bookings, by its reason, on the fixture it names: a group short of the
     * place a side waits on, a tie no rule breaks, and a club or a booking the administrator can change each say
     * which; every fault in the bracket's wiring, which nobody repairs from a screen, says only that the bracket is
     * faulty.
     */
    fault: {
      gruppe_too_small: (gruppe: string, platz: number) => `${gruppeName(gruppe)} hat keinen ${placeName(platz)}`,
      tie_unresolved: (gruppe: string, platz: number) => `Gleichstand um den ${placeName(platz)} der ${gruppeName(gruppe)}`,
      wiring: `${COPY.shared.kOBaum} fehlerhaft`,
      /** The club, and its exit as the club's exit note heads it. */
      departed_occupant: (team: Words, austritt: Copy) => `${textOf(team)} · ${austritt}`,
      fielded_twice: (team: Words) => `${textOf(team)} zweimal an diesem Spieltag`,
      /** By the booking's object, „Spielort“ or „Schiedsrichter“. */
      retired_booking: (booking: Copy) => `${booking} stillgelegt`,
      double_booked: { spielort: "Spielort doppelt belegt", schiedsrichter: "Schiedsrichter doppelt eingeteilt" } satisfies Record<
        FLBookingResource,
        string
      >,
    },
    /** „Übernehmen“'s sentence, over the two slots and whom „Spiel verlegt“ goes to. */
    adoptConsequence: "Das Spiel wird verlegt.",
    /** „Verwerfen“'s, over the slot the fixture keeps, the one proposed and the club „Termin bleibt“ goes to. */
    discardConsequence: "Der Termin bleibt.",
  },

  /**
   * The mail shell's own lines, and the words of the account's, the fixtures', the referee's and the application's mails;
   * every other mail's sentences are its template's until its area's session rewrites them.
   */
  mail: {
    greeting: "Hallo,",
    /** Under the button, above its link printed to copy. */
    buttonLink: "Falls der Knopf nicht geht, öffne diesen Link:",
    /**
     * The Art. 21 DSGVO objection, set apart from the rest as Art. 21 (4) asks, in the two parts around the league's
     * address, which the shell sets as a link between them.
     */
    // The confirmation pages' words, the shell setting the address between the parts without their spaces.
    objection: { before: OBJECTION_RIGHT.before.trimEnd(), after: OBJECTION_RIGHT.after.trimStart() },
    /** The mail's last line, by its kind: what a reader the mail was not meant for does. */
    notYou: {
      signIn: "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail.",
      security: "Warst du das nicht? Dann antworte sofort auf diese E-Mail.",
      firstContact: "Du weißt nichts davon? Dann antworte auf diese E-Mail, und wir löschen deine Angaben.",
    },

    /** A mailed link's deadline, by the hours its lifetime counts. */
    linkValidFor: (hours: number) => `Der Link gilt ${formatNumber(hours)} Stunden.`,

    /**
     * The fixture mails: a club asked to confirm a fixture's slot, a referee booked onto it, and the word of what became
     * of either. Each subject names the day; a sentence's moment is set semibold between its two parts, whose spaces
     * they hold.
     */
    spiel: {
      requestSubject: (day: CalendarDay) => `Spieltermin am ${formatDateLong(day)} bestätigen`,
      reminderSubject: (day: CalendarDay) => `Erinnerung: Spieltermin am ${formatDateLong(day)}`,
      /** Both answers named before the press, as the page offers both. */
      confirmAsk: (team: Words) => `Bestätige den Termin für ${textOf(team)} oder schlag einen anderen vor.`,
      answerMissing: (team: Words) => `Die Antwort von ${textOf(team)} fehlt noch.`,
      /** Around the deadline. */
      answerUntil: { before: "Antworte bis zum ", after: "." },
      /** Any seat of the club answers and the first press binds, so a later reader meets a link already spent. */
      firstAnswerCounts: "Es gilt die erste Antwort aus deinem Team.",

      /** A move, by the day the fixture moved to, or by the day it left where it holds no new one yet. */
      movedSubject: (day: CalendarDay) => `Spiel verlegt auf den ${formatDateLong(day)}`,
      movedFromSubject: (day: CalendarDay) => `Spiel am ${formatDateLong(day)} verlegt`,
      moved: (spiel: Words) => `${textOf(spiel)} ist verlegt.`,
      /**
       * The block's rows of a move, beside the slot's own: the moment it left and the one it moved to, in the words
       * „Übernehmen“'s question names them by.
       */
      previous: COPY.admin.facts.before,
      next: COPY.admin.facts.after,
      /** The moment a move left, where the move also changed the sides: the pairing that slot held, then the moment. */
      previousPairing: (spiel: Words, moment: string) => `${textOf(spiel)}, ${moment}`,
      /** A move whose new slot is asked later, by the reader: a club is asked, a referee booked. */
      askedLater: {
        team: "Zum neuen Termin bekommst du eine neue Anfrage.",
        schiedsrichter: "Zum neuen Termin bekommst du eine neue Einteilung.",
      },
      /** A club taken off a fixture it was asked about, around the moment it was asked about. */
      voidSubject: (day: CalendarDay) => `Nicht mehr angefragt: Spiel am ${formatDateLong(day)}`,
      void: { before: (spiel: Words) => `Die Anfrage zu ${textOf(spiel)} am `, after: " gilt nicht mehr." },

      /** A call-off, around its moment, and what a reinstated fixture brings each reader. */
      cancelledSubject: (day: CalendarDay) => `Spiel am ${formatDateLong(day)} fällt aus`,
      cancelled: { before: (spiel: Words) => `${textOf(spiel)} am `, after: " fällt aus." },
      reinstated: {
        team: "Wird das Spiel neu angesetzt, bekommst du eine neue Anfrage.",
        schiedsrichter: "Wird das Spiel neu angesetzt, bekommst du eine neue Einteilung.",
      },

      /** The referee's Einteilung, which they answer on their own Übersicht, signed in. */
      bookedSubject: (day: CalendarDay) => `Einteilung: Spiel am ${formatDateLong(day)}`,
      booked: (spiel: Words) => `Du pfeifst ${textOf(spiel)}.`,
      sayYesOrNo: "Sag zu oder ab.",
      /** A referee taken off a fixture, around the moment they were booked for. */
      unbookedSubject: (day: CalendarDay) => `Nicht mehr eingeteilt: Spiel am ${formatDateLong(day)}`,
      unbooked: { before: (spiel: Words) => `Du pfeifst ${textOf(spiel)} am `, after: " nicht mehr." },

      /** A club's proposal the league discarded, around the moment that stands. */
      keptSubject: (day: CalendarDay) => `Termin bleibt: Spiel am ${formatDateLong(day)}`,
      kept: { before: (spiel: Words) => `${textOf(spiel)} bleibt am `, after: "." },
      keptDiscarded: "Den Vorschlag deines Teams hat die Liga verworfen.",
    },

    /** An opponent's word that a club left the season. The lead follows the club's name, set semibold. */
    austrittNotice: {
      subject: (team: string) => `${team} spielt nicht mehr mit`,
      lead: { after: (saison: string) => ` ist aus der ${COPY.shared.saisonName(saison)} ausgeschieden.` },
      spiele: (count: number) => (count === 1 ? "Zu diesem Spiel meldet sich die Liga." : "Zu diesen Spielen meldet sich die Liga."),
    },

    /**
     * An application's mails. A link mail names no submitter, the form recording none. A name a lead sets semibold
     * stands outside its parts, whose spaces they hold.
     */
    bewerbung: {
      confirmOrOppose: "Bestätige deinen Eintrag oder widersprich ihm.",
      /** In the two parts around its day, as `schiedsrichterConfirmation.deadline`: the builder sets the day semibold after a space. */
      deadline: APPLICATION_DEADLINE,
      registeredAs: "Eingetragen als",
      /** The title of the facts the Ansprechperson is told. */
      status: "Stand der Bewerbung",
      /** The title of a seat's own facts. */
      entry: "Dein Eintrag",
      /** A seat a Widerspruch or an erasure emptied, where a mail lists a person by first name and seats. */
      unnamed: "Ohne Namen",

      /**
       * The Ansprechperson's link mail. It says an application came in, never that the reader sent it, and names no
       * school: behind a mistyped address a stranger gets nothing to attach the names to.
       */
      received: {
        subject: (saison: string) => `Bewerbung für die ${COPY.shared.saisonName(saison)} eingegangen`,
        lead: (saison: string) => `Für die ${COPY.shared.saisonName(saison)} ist eine Bewerbung eingegangen.`,
        named: (rollen: readonly FLKontaktRolle[]) => `Darin bist du als ${rollenText(rollen)} genannt.`,
        others: "Die anderen Kontaktpersonen bestätigen selbst. Sag ihnen Bescheid.",
        pending: "Noch offen",
      },
      /** A seat's link mail, and the fresh link „Sitz bearbeiten“ mails: each seat holds its own days, so it says one day alone. */
      link: {
        subject: (saison: string) => `Eintrag für die ${COPY.shared.saisonName(saison)} bestätigen`,
        lead: (schule: string) => `Die Bewerbung von ${schule} nennt dich als Kontaktperson.`,
      },
      reminder: {
        subject: (saison: string) => `Erinnerung: Eintrag für die ${COPY.shared.saisonName(saison)} bestätigen`,
        lead: (schule: string) => `Deine Antwort zur Bewerbung von ${schule} fehlt noch.`,
      },
      zusage: {
        subject: (saison: string) => `Zusage für die ${COPY.shared.saisonName(saison)}`,
        /** The first sentence after the club's name, the preview; the welcome stands apart from it. */
        lead: { after: (saison: string) => ` spielt in der ${COPY.shared.saisonName(saison)}.`, welcome: "Herzlich willkommen." },
        fixed: "Gruppe und Trikotfarbe stehen fest.",
        fixedNoColour: "Die Gruppe steht fest. Die Trikotfarbe teilen wir dir noch mit.",
        /** A wish answered as one: the Spielplan is drawn after the decision, so nothing here knows whether it can be met. */
        wunschgegner: (opponent: string) =>
          `Als Wunschgegner für den ersten Spieltag haben wir ${opponent} notiert. Über die Paarungen entscheidet der Spielplan.`,
        signIn: "Melde dich mit dieser Adresse an, dort findest du dein Team.",
      },
      absage: {
        subject: (saison: string) => `Absage für die ${COPY.shared.saisonName(saison)}`,
        lead: { before: "Danke für die Bewerbung von ", after: (saison: string) => ` für die ${COPY.shared.saisonName(saison)}.` },
        decision: "In dieser Saison können wir das Team nicht aufnehmen.",
        /** After `decision`: the decline stands as the application's deletion notice, so no second mail follows. */
        deletion: (days: number) => `Die Bewerbung löschen wir in ${formatNumber(days)} Tagen.`,
        title: "Die Absage",
      },
      erasure: {
        subject: (saison: string) => `Bewerbung für die ${COPY.shared.saisonName(saison)} gelöscht`,
        again: "Solange das Bewerbungsfenster offen ist, kann sich deine Schule neu bewerben.",
      },
      objection: {
        subject: (saison: string) => `Widerspruch zum Eintrag: ${COPY.shared.saisonName(saison)}`,
        lead: { after: " hat dem Eintrag als Kontaktperson widersprochen." },
        // No pronoun: „Diese Angaben“ reads correctly for every name.
        removed: "Diese Angaben haben wir aus der Bewerbung entfernt.",
        replace: "Soll eine andere Person übernehmen, antworte auf diese E-Mail.",
        /** Around the last day it stands, the deletion coming once that day has passed. */
        until: { before: "Sonst löschen wir die Bewerbung nach dem ", after: "." },
        from: "Widerspruch von",
      },
    },

    /** A seat on a team's season: its sentences are the confirmation page's, `kontaktConfirmation`. */
    kontakt: {
      subject: (team: string) => `Eintrag für ${team} bestätigen`,
      /** A closed row's button, which has nothing to confirm. */
      toEntry: "Zum Eintrag",
    },

    /** The sign-in code: no button, since a link carrying the code would sign in whoever opened a forwarded mail. */
    signInCode: {
      subject: "Dein Anmeldecode",
      lead: "Mit diesem Code meldest du dich an:",
      validity: (minutes: number) => `Er gilt ${formatNumber(minutes)} Minuten und nur einmal.`,
      /** The host the code is typed on, in the two parts around it, which the shell sets semibold between them. */
      onlyHere: { before: "Gib ihn nur auf", after: "ein." },
    },

    /** A passkey set up or deleted, in the two parts around the moment, which the shell sets semibold between them. */
    passkeyAdded: {
      subject: "Passkey eingerichtet",
      lead: { before: "Am", after: "wurde in deinem Konto ein Passkey eingerichtet." },
    },
    passkeyRemoved: {
      subject: "Passkey gelöscht",
      lead: { before: "Am", after: "wurde in deinem Konto ein Passkey gelöscht." },
      devices: "Geräte, die damit angemeldet waren, sind abgemeldet.",
    },

    /** The deletion link: the subject and the button are the act's own words, `COPY.page.accountErasure`. */
    erasureLink: {
      lead: "Du hast angefordert, dein Konto zu löschen.",
      /** The deletion box's own sentence, so the box and its mail word what goes, and what outlives it, alike. */
      consequence: COPY.account.erasure.description,
    },

    /**
     * An address change: the address on file's request, then the new address's, and the two notices of its end, sent on
     * every way a change takes.
     */
    addressChange: {
      /** The address on file's request opens on the page's question; the subject is the page's title. */
      previousEffect: "Sie gilt, sobald beide Adressen sie bestätigt haben.",
      /** To the replaced address, in the two parts around the moment, which the shell sets semibold between them. */
      effective: { subject: "E-Mail-Adresse geändert", lead: { before: "Seit", after: "gilt für dein Konto eine neue E-Mail-Adresse." } },
      /** To the new address, whose confirmed change did not take effect: never why, since its holder may be a stranger. */
      discarded: { subject: "E-Mail-Adresse nicht geändert", lead: "Für dein Konto gilt weiter die bisherige Adresse." },
      /** A change the administration started: the new address's link, then the notice to the address on file. */
      administrator: {
        lead: "Die Verwaltung hat diese E-Mail-Adresse für ein Konto eingetragen.",
        noticeSubject: "Deine E-Mail-Adresse soll sich ändern",
        noticeLead: "Die Verwaltung hat eine neue E-Mail-Adresse für dich eingetragen.",
        noticeWait: (wait: Wait) => `Sie gilt ${waitWords(wait).span}, nachdem sie bestätigt ist.`,
        noticeStop: "Bis dahin kannst du die Änderung stoppen.",
      },
    },

    /**
     * A ban's notice, the one record this reader ever gets, whose sign-in the ban ends: Art. 13 asks its basis and
     * rights here, and the shell's objection closes it.
     */
    ban: {
      subject: "Deine E-Mail-Adresse ist gesperrt",
      lead: "Die Verwaltung hat deine E-Mail-Adresse gesperrt.",
      effect: "Mit ihr kannst du dich nicht anmelden und bekommst keine E-Mails der Liga.",
      ends: (saison: string) => `Die Sperre endet nach der ${COPY.shared.saisonName(saison)} von selbst.`,
      stored: "In der Sperrliste stehen deine Adresse, der Grund, das Datum und wer die Sperre eingetragen hat.",
      account:
        "Dein Konto bleibt, solange unter dieser Adresse ein Eintrag bei uns besteht. Die Sperre bleibt auch nach einer Löschung bis zu ihrem Ende.",
      basis:
        "Wir speichern das auf Grundlage unseres berechtigten Interesses, den Spielbetrieb vor Störungen zu schützen (Art. 6 Abs. 1 lit. f DSGVO).",
      /** Around the league's address. */
      rights: { before: "Für eine Kopie deiner Daten, ihre Löschung, einen Widerruf oder Fragen zur Sperre schreib uns an ", after: "." },
    },

    /** The notice to every holder and the person named, one body for every reader, by what changed. */
    grant: {
      subject: {
        granted: "Neuer Zugang zur Verwaltung",
        handover: `Übergabe der ${ownerTier} angekündigt`,
        address: "Neue Adresse in der Verwaltung",
        revoked: "Zugang zur Verwaltung beendet",
        withdrawn: "Angekündigte Änderung zurückgezogen",
        completed: "Angekündigte Änderung gilt jetzt",
      },
      lead: {
        granted: (address: string) => `${address} bekommt Zugang zur Verwaltung.`,
        handover: (address: string) => `Die ${ownerTier} der Verwaltung geht an ${address}.`,
        address: (previous: string, next: string) => `${previous} wechselt zu ${next}.`,
        revoked: (address: string) => `${address} hat keinen Zugang zur Verwaltung mehr.`,
        withdrawn: {
          granted: (address: string) => `${address} bekommt keinen Zugang zur Verwaltung.`,
          handover: (address: string) => `Die ${ownerTier} geht nicht an ${address}.`,
          address: (previous: string, next: string) => `${previous} wechselt nicht zu ${next}.`,
        },
        /** A wait a pass completed, so no `by` line follows. */
        completed: {
          handover: (address: string) => `${address} leitet jetzt die Verwaltung.`,
          address: (previous: string, next: string) => `Die Adresse ${previous} heißt jetzt ${next}.`,
          /** A completion queued when its person was erased: both its addresses are theirs. */
          unnamedAddress: "Eine nicht genannte Adresse hat gewechselt.",
        },
      },
      /** Who acted and when, by the act. */
      by: {
        entered: (actor: string, moment: string) => `Eingetragen von ${actor} am ${formatInstant(moment)}.`,
        removed: (actor: string, moment: string) => `Entfernt von ${actor} am ${formatInstant(moment)}.`,
        withdrawn: (actor: string, moment: string) => `Zurückgezogen von ${actor} am ${formatInstant(moment)}.`,
      },
      /** On what waits. */
      effectiveFrom: (moment: string) => `Die Änderung gilt ab ${formatInstant(moment)}.`,
      warn: `Stimmt das nicht, melde dich sofort bei der ${ownerTier}.`,
      button: "Zur Verwaltung",
      /** An erased person's address, in the subject's place. */
      unnamedAddress: "Eine nicht genannte Adresse",
      /** The same, as a lead's object after „an“ or „heißt jetzt“. */
      unnamedTarget: "eine nicht genannte Adresse",
      /** An erased actor, after „von“, and an erased new address, after „zu“. */
      unnamedActor: "einer nicht genannten Adresse",
    },

    /** The one notice of a deletion: an account's, or an application's that did not come about, to each seat that confirmed. */
    deletion: {
      account: `Dein Konto und deine Angaben sind gelöscht, bis auf das, was unter „${COPY.page.privacyNotice}“ steht.`,
      bewerbung: {
        // True of a lapse and of an application undecided at its season's end alike.
        lead: (saison: string) => `Die Bewerbung für die ${COPY.shared.saisonName(saison)} kam nicht zustande.`,
        deleted: "Wir haben sie mit allen Angaben gelöscht.",
      },
    },

    /**
     * A team's registration link, to a confirmed contact seat: the link stands alone in the box, to be passed on
     * rather than pressed. It names no end date, since a window moved later moves every link with it.
     */
    invitation: {
      subject: (team: string) => `Registrierungslink für ${team}`,
      passOn: (saison: string, team: string) =>
        `Gib diesen Link an alle weiter, die in der ${COPY.shared.saisonName(saison)} für ${team} spielen.`,
      key: "Wer den Link hat, kann sich für dein Team registrieren.",
      admission: "In den Kader kommt nur, wen dein Team aufnimmt.",
      valid: "Der Link gilt bis zum Ende der Registrierung.",
    },
  },

  /**
   * The two pages a mail opens for the account, `/confirm/address` and `/erasure`, in the states of
   * `fl_frontend/src/kit/MailedPage.tsx`. The address change's two mails open on these pages' questions.
   */
  addressChange: {
    /** The noun of the address on file's act, „Änderung bestätigen“: Konto's word for the pending change. */
    change: COPY.account.address.change,
    /** The address on file's question names the address the change goes to under Konto's label for it. */
    newAddress: COPY.account.address.new,
    previous: {
      question: "Für dein Konto soll eine neue E-Mail-Adresse gelten.",
      confirmed: "Änderung bestätigt",
      stopped: "Änderung gestoppt",
    },
    new: {
      question: `Diese Adresse soll künftig für ein Konto bei der ${COPY.brand.name} gelten.`,
      /** A change the administration started: the link's page and its mail alike. */
      waits: (wait: Wait) => `Sie gilt ${waitWords(wait).span} nach deiner Bestätigung.`,
      confirmed: ADDRESS_CONFIRMED,
      /** The done page's title on a change that waits. */
      confirmedFrom: (day: CalendarDay) => `${ADDRESS_CONFIRMED}, gilt ab ${formatDateLong(day)}`,
    },
    declined: "Änderung abgelehnt",
  },
  accountErasure: {
    /** Under the list of what goes, each row a record the read found. */
    question: "Alles oben wird endgültig gelöscht.",
    /** The list's rows beside each record's own: the account's passkeys, under their box's title, its live address changes, its grant. */
    passkeys: COPY.account.passkeys.title,
    addressChanges: COPY.admin.erasure.count.addressChanges,
    grant: COPY.admin.erasure.count.grant,
    done: COPY.admin.actionLog.action["erasure.own"],
  },

  /**
   * The landing's sections and the blocks About, Kontakt and the sponsors page share with it, each read by a Server
   * Component.
   */
  landing: {
    /** The hero's one heading. */
    tagline: "Frankfurts Abi-Jahrgänge spielen um den Titel",
    /**
     * The two paragraphs the league describes itself with, under the tagline and at the head of About: what the league
     * is, then who stands behind a team and who runs it.
     */
    paragraphs: [
      COPY.brand.description,
      "Hinter jedem Team steht eine ganze Schule, die zu den Spielen kommt und mitfiebert. Ehrenamtliche aus den Jahrgängen organisieren die Liga, von der Bewerbung bis zum Finale.",
    ],
    /** The way to apply while a window is open: the hero's second act, the steps' band and the school's door. */
    toBewerbung: "Zur Bewerbung",

    /** What About tells in short sections, each written once: the landing's pillars and its small cards read them too. */
    about: {
      who: {
        title: "Wer spielt",
        text: "Nur der Abi-Jahrgang, für den das Team antritt, in jeder Zusammensetzung. Lehrkräfte sind als Fans willkommen.",
      },
      rules: {
        title: "Die Regeln",
        text: "11 gegen 11 über 90 Minuten, bei jedem Wetter. Die Schiedsrichter kommen, soweit möglich, von außerhalb.",
      },
      purpose: { title: "Wofür", text: "Beide Teams verdienen an Tickets und am Verkauf vor Ort und teilen den Erlös." },
      spielorte: { title: COPY.page.adminSpielorte, text: "Kein zentraler Platz. Wo und wann ein Spiel stattfindet, steht im Spielplan." },
      admission: { title: "Eintritt", text: "2 bis 5 €, je nach Spiel. Im Vorverkauf meist günstiger." },
      safety: { title: "Sicherheit", text: "Bei den meisten Spielen sind Sanitäter vor Ort." },
    },

    pillars: { eyebrow: "Unser Ziel", title: "Fußball, der den Abiball bezahlt" },

    /** How a school joins: four numbered steps, and the band under them. */
    join: {
      eyebrow: "Bewerbung",
      title: "Der Weg in die Liga",
      apply: {
        title: "Bewerbung abschicken",
        text: "Schule, Stufe, die Kontaktpersonen und die geplante Kadergröße, solange das Fenster offen ist.",
      },
      confirm: {
        title: "Kontaktpersonen bestätigen",
        text: (days: number) => `Jede Kontaktperson bestätigt ihren Eintrag innerhalb von ${formatNumber(days)} Tagen über einen eigenen Link.`,
      },
      decision: {
        title: "Zusage der Liga",
        text: "Wir prüfen die Bewerbung und sagen zu oder ab. Mit der Zusage ist deine Schule Teil der Saison.",
      },
      register: {
        title: "Spieler registrieren",
        text: "Dein Team bekommt einen Link, über den sich dein Jahrgang registriert. Die Kontaktpersonen nehmen die Spieler in den Kader auf.",
      },
      /** The band while no season not yet ended holds a window; a window that stands reads `bewerbung.end`, as the form's page does. */
      closed: "Das Bewerbungsfenster ist gerade geschlossen. Versuche es nächste Saison.",
      /** The school's door while a window is open, where the band and the season card carry its date. */
      opened: "Das Bewerbungsfenster ist offen.",
    },

    /**
     * How a season runs: the numbered dotted line, worded so it holds for any number of groups and rounds. Each
     * point's text; its title is the name the season pages give the phase or the match.
     */
    season: {
      eyebrow: SPIELBETRIEB,
      title: "So läuft eine Saison",
      gruppenphase: "Die Teams spielen in Gruppen jeder gegen jeden.",
      kORunde: "Wer verliert, scheidet aus. Bei Gleichstand entscheidet das Elfmeterschießen.",
      platz3: "Die beiden Verlierer der Halbfinale spielen um Platz 3.",
      finale: "Das Spiel um den Titel.",
    },

    /** The league in four counts, over every season the public reads. */
    figures: {
      eyebrow: "Statistiken",
      title: "Die Liga in Zahlen",
      saisons: "Saisons",
      schulen: "Schulen",
      spiele: COPY.page.spiele,
      tore: COPY.shared.tore,
    },

    organisers: {
      eyebrow: "Organisation",
      title: "Wer dahintersteht",
      /** What each organiser does, under their first name. */
      role: { vorstand: "Vorstand", spielbetrieb: SPIELBETRIEB, website: "Website", communication: "Kommunikation" },
    },

    /** The eyebrow over the sponsors' section, whose title is the sponsors page's own. */
    sponsors: { eyebrow: "Unterstützung" },

    /** The ways in: the school's while a window is open, and the question's; the heading counts them. */
    doors: {
      eyebrow: "Bei Anliegen",
      title: (withSchool: boolean) => (withSchool ? "Zwei Wege zu uns" : "Wege zu uns"),
      school: { title: "Deine Schule will antreten" },
      question: {
        title: "Du hast eine Frage",
        text: "Zum Spielbetrieb, zu einer Bewerbung oder zur Liga: Schreib uns. Wir melden uns schnellstmöglich.",
      },
      /** The sponsors page's door, under its tiles. */
      support: "Du willst die Liga unterstützen",
    },

    schools: { eyebrow: "Wer dabei ist", title: (saison: string) => `Schulen der ${COPY.shared.saisonName(saison)}` },

    /** The season card beside the hero, in its states. */
    saison: {
      /** The opening match's Anpfiff, when it is set to start. */
      opening: (when: Copy) => `Anpfiff ${when}`,
      /** The opening match's matchday, before its two plaques. */
      spieltag: COPY.shared.spieltag,
      /** An open window's deadline, on the season card and the steps' band alike. */
      windowUntil: (until: CalendarDay) => `Bewerbungen bis ${formatDate(until)}`,
      last: "Zuletzt",
      next: "Als Nächstes",
      place: placeName,
      /** A place left vacant, its club having left the season before it was decided, beside the dashed open plaque. */
      vacant: "Nicht vergeben",
    },

    /** The league's mail address by its label: Kontakt's row, and the doors' and the sponsors page's link. */
    contact: {
      email: "E-Mail",
    },
  },

  /** The not-found page's title, in every frame. */
  notFound: "Seite nicht gefunden",

  /** One word for where a season stands, before its start, running or decided: a season card's chip, a list's. */
  saisonState: { planned: "Geplant", running: "Läuft", decided: "Entschieden" },

  /**
   * The public season pages and the kit's season blocks, drawn on the server alone. Every entry is a draft for
   * the season board.
   */
  season: {
    /** One group's card on the Tabelle, and a club's group on Teams and its page. */
    gruppe: gruppeName,
    /** The match between the two semi-finals' losers: its label, its card's row above the Finale, the pop-up's head. */
    thirdPlace: "Spiel um Platz 3",
    /** A match's own label before its date, on the one line every form of its row shows. */
    labelled: (label: Words, when: Words) => `${textOf(label)} · ${textOf(when)}`,
    /**
     * Where a club stands, under its name in a match head, linking to its row on the Tabelle; a club that has
     * played no match holds no place yet, and the line names its group alone.
     */
    standing: (platz: number | null, gruppe: string) => (platz === null ? gruppeName(gruppe) : `${placeName(platz)} · ${gruppeName(gruppe)}`),

    /** The Tabelle's and the club page's column heads: the short forms on every width. */
    column: {
      platz: PLATZ,
      team: TEAM,
      spiele: "Sp.",
      siege: "S",
      unentschieden: "U",
      niederlagen: "N",
      /** A phone's one column for the three counts, its figures in green, yellow and red. */
      record: "S-U-N",
      tore: COPY.shared.tore,
      differenz: DIFFERENZ,
      punkte: "Pkt.",
      name: COPY.shared.name,
      nummer: "Nr.",
      position: COPY.admin.spieler.position,
    },

    /** The Spielsuche's three filters and Teams' one, each opening on every match or club. */
    filter: { phase: "Phase", team: TEAM, spieltag: COPY.spielplan.fact.spieltag, gruppe: COPY.team.gruppe, all: "Alle" },

    /** A club's page: its tiles, its matches and its squad. */
    club: {
      platz: PLATZ,
      punkte: "Punkte",
      spiele: COPY.page.spiele,
      tore: COPY.shared.tore,
      /** Under the goals: their difference, signed. */
      differenz: (difference: number) => `${DIFFERENZ} ${formatSigned(difference)}`,
    },

    /** A match's page: its line-ups, and its goals and cards by minute. */
    spiel: {
      aufstellung: "Aufstellung",
      toreAndCards: "Tore und Karten",
      /**
       * The plural the match's empty timeline names until its report is adopted, whose goals and cards are not
       * official before: „Noch keine offiziellen Tore und Karten.“, where an adopted report naming none reads
       * „Noch keine Tore und Karten.“
       */
      officialToreAndCards: "offiziellen Tore und Karten",
      /** A pupil whose consent publishes no name, or one erased since. */
      anonymous: "anonym",
      /** A goal nobody was named for. */
      unknown: "unbekannt",
      tor: "Tor",
      eigentor: "Eigentor",
      card: { gelb: "Gelbe Karte", gelb_rot: "Gelb-Rote Karte", rot: "Rote Karte" },
      /** A checkpoint's title: what happened, and to whom. */
      event: (what: Copy, who: Words) => `${what} · ${textOf(who)}`,
    },
  },

  /**
   * The two legal pages' text, which their pages set as the kit's `Prose` blocks under their titles; the copy
   * standard's legal section governs it. A bound the frontend's code holds is a parameter, so the text states the one
   * the code keeps; a provider's period, and a bound only the backend or a later build holds, is written out. A
   * paragraph with a link stands in parts around it, `before` and `after`, which the page sets the link between.
   */
  legal: {
    privacyNotice: {
      firstLayer: {
        heading: "Das Wichtigste",
        items: [
          `Verantwortlich ist der ${VEREIN_NAME}, ${VEREIN_ADDRESS}.`,
          "Wir verarbeiten, was du uns für eine Bewerbung, einen Kader, ein Spiel oder deine Anmeldung angibst, und die technischen Daten jedes Aufrufs.",
          "Wir brauchen diese Daten, um den Spielbetrieb der Liga durchzuführen, dich zu erreichen und die Website sicher zu betreiben.",
          "Öffentlich sind Teams, Spielpläne, Ergebnisse und Aufstellungen; deinen Namen zeigen wir dort nur mit deiner Einwilligung.",
          "Wir messen nicht, was du auf der Website tust, und verkaufen keine Daten.",
          "Du kannst Auskunft, Berichtigung, Löschung, Einschränkung und die Herausgabe deiner Daten verlangen, widersprechen, jede Einwilligung widerrufen und dich bei der Aufsichtsbehörde beschweren.",
        ],
        /** The last item, around the league's address. */
        contact: { before: "Dafür genügt eine formlose E-Mail an ", after: "." },
      },
      basis: {
        heading: "Rechtsgrundlagen",
        text: "Wo nichts anderes steht, verarbeiten wir deine Daten auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen, dich zu erreichen, Fehler in den Daten zu erkennen und die Website vor Angriffen und Missbrauch zu schützen. Wo du eine Einwilligung gibst, ist sie die Grundlage (Art. 6 Abs. 1 lit. a DSGVO). Die Namen des Vorstands im Impressum nennen wir, weil das Gesetz es verlangt (§ 5 DDG, Art. 6 Abs. 1 lit. c DSGVO).",
      },
      website: {
        heading: "Website und Browser",
        requests:
          "Jede Anfrage an die Website läuft zuerst über Cloudflare, Inc.; Cloudflare sieht dabei deine IP-Adresse, die aufgerufene Adresse, die Angaben deines Browsers und jedes Formular, das du abschickst. Bei jedem Aufruf speichert unser Server deine IP-Adresse, den Zeitpunkt, die aufgerufene Seite, den Statuscode und die Kennung deines Browsers.",
        // The passkey cookie's 5 minutes are Better Auth's own, which the library sets and exports no name for; the mailed
        // link's hour is `fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_SECONDS`.
        browser:
          "In deinem Browser legt die Website nur ab, was ihr Betrieb braucht: ein Sitzungs-Cookie, sobald du dich anmeldest, ein Cookie für die Anmeldung mit einem Passkey, das 5 Minuten gilt, ein Cookie, das einen Link aus einer E-Mail eine Stunde lang hält, bis du ihn benutzt, und im lokalen Speicher die Darstellung, hell oder dunkel, die du wählst. Auf der Anmeldeseite, im Bewerbungsformular und im Registrierungsformular prüft Cloudflare Turnstile, ob ein Mensch das Formular abschickt, und fragt dafür Merkmale deines Browsers und deiner Verbindung ab; Cloudflare nutzt sie auch in eigener Verantwortung, um seine Erkennung automatisierter Zugriffe zu verbessern. Beides ist nach § 25 Abs. 2 Nr. 2 TDDDG ohne Einwilligung zulässig.",
      },
      bewerbung: {
        heading: "Bewerbung einer Schule",
        form: "Das Bewerbungsformular fragt Angaben zur Schule und zu ihrem Team ab, darunter die Anschrift der Schule. Für jede Rolle, Trainerin oder Trainer, Ansprechperson und Stellvertretung, fragt es Name, E-Mail-Adresse und Telefonnummer einer Person ab; eine Person kann zwei Rollen haben. Freiwillig sind nur die Website der Schule, der Trikotsatz und der Wunschgegner. Die Angaben zu den Kontaktpersonen erhalten wir von der Person, die die Bewerbung einreicht.",
        confirmation: (days: number, trainerAge: number, otherAge: number) =>
          `Jede Kontaktperson bestätigt ihren Eintrag innerhalb von ${formatNumber(days)} Tagen über einen eigenen Link mit ihrem Geburtsdatum oder widerspricht ihm, ebenso wenn die Liga sie selbst einträgt. An eine E-Mail-Adresse mit mehreren offenen Links der Saison geht kein weiterer, außer die Liga sendet ihn. Das Mindestalter ist ${formatNumber(otherAge)} Jahre, für eine Trainerin oder einen Trainer ohne zweite Rolle ${formatNumber(trainerAge)}. Die Ansprechperson erfährt, wenn sie angeschrieben ist, Vornamen und Rollen der anderen Kontaktpersonen und wer widerspricht. Widerspricht eine Kontaktperson, entfernen wir ihre Angaben aus der Bewerbung. Bestätigt eine Kontaktperson nicht rechtzeitig, löschen wir die Bewerbung und schreiben das allen, die ihren Eintrag bestätigt haben. Hat die Liga sie direkt bei einem Team eingetragen, löschen wir nur ihren Eintrag.`,
      },
      kader: {
        heading: "Im Kader",
        // Session 8: the link's 14 days become a parameter read from `REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE` once that
        // constant holds the 14 days every link confirming a registered person lives.
        text: (minAge: number) =>
          `In den Kader eines Teams registrierst du dich über dessen Link mit Name und E-Mail-Adresse, wenn du willst auch mit Rückennummer, Position und Stufe, und bestätigst innerhalb von 14 Tagen über einen Link mit deinem Geburtsdatum, dass du mindestens ${formatNumber(minAge)} Jahre alt bist. Über die Aufnahme entscheiden die Kontaktpersonen des Teams; deine E-Mail-Adresse, dein Geburtsdatum und deine Antworten sehen sie nicht.`,
      },
      schiedsrichter: {
        heading: "Schiedsrichterinnen und Schiedsrichter",
        // The referee's minimum age is the backend's alone, `fl_backend/app/shared/schemas/bounds.py`.
        text: (days: number) =>
          `Pfeifst du für die Liga, trägt sie dich mit Name, Kontaktdaten, Schule und Honorar ein, so wie du oder die Person, die dich genannt hat, sie uns mitteilt. Über einen Link bestätigst du den Eintrag innerhalb von ${formatNumber(days)} Tagen mit deinem Geburtsdatum; pfeifen kann, wer mindestens 16 Jahre alt ist. Löschen wir deinen Eintrag, bleibt an angesetzten und gespielten Spielen das Honorar ohne deinen Namen stehen.`,
      },
      spiele: {
        heading: "Spiele und Spielberichte",
        text: "Vor einem Spiel fragen wir beide Teams und die Schiedsrichterin oder den Schiedsrichter, ob der Termin steht; eine Absage kann eine Begründung als freien Text tragen. Nach dem Spiel trägt die Schiedsrichterin oder der Schiedsrichter einen Spielbericht ein: Ergebnis, Tore und Karten mit Minute und Person, zu einer Karte einen Grund aus einer festen Liste und Bemerkungen als freien Text.",
      },
      account: {
        heading: "Anmeldung und Konto",
        // An administrator's idle hour is typed as its one figure: a sentence reading „nach 1 Stunde“ is singular.
        signIn: (code: { minutes: number }, person: { idleDays: number; days: number }, admin: { idleHours: 1; hours: number }) =>
          `Du meldest dich mit einem Code an, den wir dir schicken und nach ${formatNumber(code.minutes)} Minuten löschen, oder mit einem Passkey, zu dem wir seinen öffentlichen Schlüssel mit Kennung und Zähler, den Anbieter, bei dem er liegt, ob er gesichert ist, wie dein Gerät ihn erreicht, seinen Namen und seine letzte Nutzung speichern, nie seinen privaten Schlüssel; mit Zugang zur Verwaltung nur mit einem Passkey. Eine Sitzung endet nach ${formatNumber(person.idleDays)} Tagen ohne Nutzung, spätestens nach ${formatNumber(person.days)} Tagen; mit Zugang zur Verwaltung nach ${formatNumber(admin.idleHours)} Stunde ohne Nutzung, spätestens nach ${formatNumber(admin.hours)} Stunden.`,
        changes: (linkHours: number, stopDays: number, administratorWait: Wait, ownerWait: Wait) =>
          `Eine neue E-Mail-Adresse bestätigst du zuerst über einen Link an deine bisherige Adresse und danach über einen Link an die neue, jeder ${formatNumber(linkHours)} Stunden gültig; sie gilt, sobald du beide bestätigt hast. Kommst du an deine bisherige Adresse nicht mehr heran, ändert die Liga sie auf deine Anfrage und vermerkt den Grund; die bisherige Adresse erfährt davon und kann die Änderung ${formatNumber(stopDays)} Tage lang stoppen. Mit Zugang zur Verwaltung gilt eine neue Adresse erst ${waitWords(administratorWait).span}, nachdem du beide bestätigt hast, für die ${ownerTier} und die Person, an die sie übergeben wird, erst ${waitWords(ownerWait).after}; bis dahin gilt die bisherige. Ein neuer Zugang gilt erst ${waitWords(administratorWait).after}, die Übergabe der ${ownerTier} erst ${waitWords(ownerWait).after}. Alle mit Zugang und die genannte Person erfahren sofort davon, mit der Adresse der Person aus der Verwaltung, die es veranlasst hat; bei einer Änderung auf Anfrage steht dort keine, und die bisherige Adresse erfährt nur von dieser Änderung. Bis dahin kann die ${ownerTier} alles davon zurücknehmen; eine neue Adresse auch du selbst, im Konto oder über den Link an deine bisherige Adresse. Dein Konto löschst du selbst, bestätigt über einen Link an deine Adresse. Mit der ${ownerTier} geht das erst nach ihrer Übergabe, weil die Liga immer eine ${ownerTier} braucht; deine Rechte unter „Deine Rechte“ bleiben davon unberührt. Sonst bleibt es, solange unter deiner Adresse ein Eintrag bei uns besteht.`,
        ban: "Stört eine Adresse den Spielbetrieb, kann die Verwaltung sie sperren. Mit ihr meldet sich dann niemand an, und sie bekommt keine E-Mails. Hat sie ein Konto, schreiben wir das dorthin.",
      },
      mail: {
        heading: "E-Mail und WhatsApp",
        senders:
          "Unsere E-Mails verschicken wir über Resend, Codes und Sicherheitshinweise von anmeldung@frankfurtleague.de, alle anderen von liga@frankfurtleague.de; Resend meldet uns, ob eine E-Mail ankommt, und wir speichern das bei der Nachricht.",
        forwarding:
          "Ein eigenes Postfach hat die Liga nicht: E-Mails an die Liga leitet Cloudflare an die privaten Postfächer der Personen weiter, die die Liga organisieren, und die Antwort kommt von deren privater Adresse. Den Inhalt speichert Cloudflare nach eigener Angabe nicht, nur Absender, Empfänger und Betreff. Deine Nachricht löschen wir, sobald sie erledigt ist und keine Pflicht zur Aufbewahrung besteht.",
        whatsapp:
          "Über WhatsApp schreiben wir dir nur, wenn du das erlaubt hast oder uns dort schreibst; dann erhält WhatsApp deine Telefonnummer und die Nachrichten.",
      },
      published: {
        heading: "Was wir veröffentlichen",
        record:
          "Auf der Website stehen Name, Kürzel, Schule und Anschrift jedes Teams, Spielpläne, Ergebnisse und Tabellen, Aufstellungen, sobald ein Team sie einträgt, Tore und Karten, sobald der Spielbericht feststeht, und als freier Text Notizen zu Spielen, Beschreibungen von Teams und der Grund für einen Rückzug.",
        names:
          "Stehst du im Kader, zeigen wir dort, in Aufstellungen und bei Toren und Karten deinen Vornamen und den Anfangsbuchstaben deines Nachnamens; pfeifst du, zeigen wir an deinen Spielen den ersten Teil deines Namens und den Anfangsbuchstaben des nächsten, bei nur einem Namen diesen ganz. Beides zeigen wir nur mit deiner Einwilligung, sonst steht dort „anonym“; im Kader stehen Rückennummer und Position in beiden Fällen.",
        consented: (mediaAge: number) =>
          `Ebenfalls nur mit Einwilligung zeigen wir die Vornamen der Personen, die die Liga organisieren, auf der Startseite und unter „${COPY.page.about}“ und, ab ${formatNumber(mediaAge)} Jahren, Fotos, Videos und Interviews, auf denen du zu erkennen bist, hier und auf dem Instagram-Kanal der Liga. Widerrufst du, entfernen wir Fotos, Videos und Interviews von dir von der Website und vom Instagram-Kanal der Liga.`,
        never:
          "Nie veröffentlichen wir Kontaktdaten, Geburtsdaten, Registrierungen, Kontaktpersonen, Antworten zu Einwilligungen, die Stufe, Schule und Honorar einer Schiedsrichterin oder eines Schiedsrichters, Kartengründe und die Bemerkungen eines Spielberichts.",
      },
      recipients: {
        heading: "Empfänger",
        lead: "Außer uns und den oben genannten Personen erhalten deine Daten nur:",
        items: [
          "Hetzner Online GmbH, Nürnberg: unser Server;",
          "Cloudflare, Inc.: jede Anfrage, Turnstile und die Weiterleitung von E-Mails;",
          "MongoDB, Inc.: die Datenbank und ihre Sicherungskopien, in Frankfurt am Main;",
          "Resend (Plus Five Five, Inc.): unsere E-Mails;",
          "die Anbieter der privaten Postfächer: E-Mails an die Liga, unsere Antworten und Mitteilungen zum Zugang zur Verwaltung, ohne Vertrag zur Auftragsverarbeitung;",
          "WhatsApp Ireland Limited, wenn du WhatsApp erlaubst: die gewöhnliche App, ohne Vertrag zur Auftragsverarbeitung;",
          "Meta (Instagram), selbst verantwortlich: die Fotos, Videos und Interviews, die du erlaubst.",
        ],
        transfers:
          "In die Vereinigten Staaten übermitteln wir auf Grundlage des Angemessenheitsbeschlusses zum EU-US Data Privacy Framework (Art. 45 DSGVO), für Cloudflare und Resend auch der Standardvertragsklauseln der Europäischen Kommission (Art. 46 Abs. 2 lit. c DSGVO), deren Kopie wir dir auf Anfrage schicken. Ein privates Postfach kann in einem Land ohne Angemessenheitsbeschluss liegen; für diese Übermittlung gibt es keine geeigneten Garantien. Darüber hinaus geben wir keine Daten weiter, auch nicht an unsere Sponsoren.",
      },
      /**
       * The retention table: each store's name, what it holds and how long. A bound the frontend's code holds is a
       * parameter; the rest are the rulings' and the providers', several of which only the backend, a host script or a
       * later session's build holds, so each is written out. A confirmation link's days stand for a declined item's
       * too, the rulings giving both one wait.
       */
      retention: {
        heading: "Speicherdauer",
        nameLabel: "Daten",
        content: "Inhalt",
        period: "Dauer",
        rows: [
          {
            name: "Bewerbung",
            content: "Schule, Team, Kontaktpersonen",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.bewerbungDays)} Tage, wenn nicht alle bestätigen; abgelehnt ${formatNumber(bound.bewerbungDays)} Tage; sonst bis zum Ende der Saison danach`,
          },
          {
            name: "Kontaktpersonen",
            content: "Kontaktdaten, Geburtsdatum, Antworten",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.bewerbungDays)} Tage, wenn unbestätigt oder abgelehnt; sonst bis zum Ende der Saison danach`,
          },
          // Session 8: the 14 days become `REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE` once that constant holds them.
          { name: "Registrierung", content: "Name, Adresse, Geburtsdatum", period: "14 Tage, wenn unbestätigt oder abgelehnt" },
          {
            name: "Registrierungslinks",
            content: "Team, Saison, Adresse der Person aus der Verwaltung, die ihn erstellt hat",
            period: "ohne Frist; die Adresse bis zur Löschung dieser Person",
          },
          { name: "Kader und Aufstellungen", content: "Name, Adresse, Geburtsdatum, Antworten", period: "bis zum Ende der Saison danach" },
          {
            name: "Schiedsrichter",
            content: "Name, Kontaktdaten, Honorar, Antworten",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.schiedsrichterDays)} Tage, wenn unbestätigt oder abgelehnt; sonst bis du oder die Liga den Eintrag beenden`,
          },
          {
            name: "Teams und Spiele",
            content: "Ergebnisse, Tore, Karten, Notizen",
            period: "als Chronik der Liga; Namen darin nur, solange der Eintrag der Person besteht",
          },
          { name: "Freie Texte zu Spielen", content: "Absagegründe, Kartengründe, Bemerkungen", period: "bis zum Ende der Saison danach" },
          {
            name: "Gesperrte Adresse",
            content: "Adresse, Grund, Datum, wer sie eingetragen hat",
            period: "bis zum Ende der 5. Saison danach",
          },
          {
            name: "Zugang zur Verwaltung",
            content: "Adresse, Stufe, Beginn, wer ihn vergeben hat",
            period: "bis er endet; eine Sperre oder ein Zugang, den du eingetragen hast, nennt dich weiter, bis wir deine Daten löschen",
          },
          { name: "Konto", content: "Adresse, Passkeys", period: "solange ein Eintrag besteht" },
          {
            name: "Anmeldung",
            content: "Code; Zahl der Codes und der Fehlversuche je Adresse, pseudonymisiert",
            period: (bound: RetentionBounds) =>
              `Code ${formatNumber(bound.code.minutes)} Minuten; Codes ${formatNumber(bound.code.mailHours)} Stunde, Fehlversuche ${formatNumber(bound.code.failureHours)} Stunden`,
          },
          {
            name: "Sitzungen",
            content: "Beginn, letzte Nutzung, Art der Anmeldung",
            period: (bound: RetentionBounds) =>
              `${formatNumber(bound.person.idleDays)} Tage ohne Nutzung, höchstens ${formatNumber(bound.person.days)}; mit Zugang zur Verwaltung ${formatNumber(bound.admin.idleHours)} Stunde ohne Nutzung, höchstens ${formatNumber(bound.admin.hours)} Stunden`,
          },
          // The ended change's 30 days are the backend's alone, `fl_backend/app/shared/schemas/bounds.py ::
          // ADDRESS_CHANGE_RETENTION_DAYS`.
          {
            name: "Adressänderung",
            content: "Beide Adressen; bei einer Änderung auf Anfrage der Grund",
            period: (bound: RetentionBounds) =>
              `jeder Link ${formatNumber(bound.addressChangeLinkHours)} Stunden; Adressen und Grund bis zu ihrem Ende, der Rest 30 Tage danach`,
          },
          { name: "Protokoll der Liga", content: "Wer was wann geändert hat, ohne Inhalte; beim Zugang die Adresse", period: "12 Monate" },
          // The end state's one store: the erasure journal is written as the server's own journald lines, kept nine days,
          // so the host script that exports a day file today states nothing here.
          {
            name: "Protokolle des Servers",
            content:
              "Aufrufe, Anmeldungen; Löschungen, Widerrufe und Widersprüche mit der Nummer des Eintrags, bei Kontaktpersonen auch dem Tag der Bestätigung",
            period: "9 Tage",
          },
          { name: "Unsere E-Mails", content: "Inhalt, Adresse, Zustellstand", period: "Inhalt bis zum Versand, der Rest 30 Tage danach" },
          { name: "E-Mails bei Resend", content: "Adresse, Betreff, Inhalt", period: "30 Tage, in Sicherungen bis 7 Tage länger" },
          { name: "E-Mails bei Cloudflare", content: "Absender, Empfänger, Betreff", period: "31 Tage" },
          { name: "Turnstile bei Cloudflare", content: "Signale deines Browsers beim Absenden eines Formulars", period: "7 Tage" },
        ],
      },
      erasure: {
        heading: "Löschung",
        text: "Löschen wir Daten, auf deinen Wunsch oder nach ihrer Frist, verschwinden sie sofort aus der Datenbank und nach etwa 8 Tagen aus den Sicherungskopien; spielen wir eine ältere Sicherung ein, löschen wir sie erneut. Es bleiben die Kopien bei Resend und Cloudflare bis zu ihren Fristen, die Protokolle des Servers mit der Nummer eines Eintrags und, bei Kontaktpersonen, dem Tag der Bestätigung bis zu ihrer Frist, eine Sperre deiner Adresse bis zu ihrem Ende, die E-Mail mit dem Link zur Löschung, bis er abläuft, Mitteilungen zum Zugang zur Verwaltung, die andere schon erhalten haben, und freie Texte, die nicht unter deiner Adresse stehen. Löschen wir ein bestätigtes Konto, schreiben wir dir das, ebenso, wenn wir eine Bewerbung löschen, die nicht zustande kam und in der du deinen Eintrag bestätigt hast, außer an eine gesperrte Adresse; eine Absage nennt die Löschung schon selbst.",
        log: "Was die Verwaltung an den Daten der Liga ändert, halten wir 12 Monate im Protokoll der Liga fest, ebenso, was Kontaktpersonen und Schiedsrichter für andere ändern, und die Löschung von Einträgen. Ein Eintrag sagt, wer es war, was geschah und wann, ohne alten oder neuen Inhalt. Beim Zugang zur Verwaltung steht darin die Adresse der genannten Person, auch wenn der Zugang nie galt. Die Verwaltung steht darin mit ihrer Adresse, alle anderen ohne Namen und Adresse. Zu einer Löschung stehen dort, wer sie veranlasst hat, und ein Verweis auf die Anfrage. Löschen wir deine Daten, ersetzt ein fester Vermerk deine Adresse.",
      },
      rights: {
        heading: "Deine Rechte",
        /** Around the league's address. */
        text: {
          before:
            "Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit (Art. 15 bis 18 und 20 DSGVO). Eine Einwilligung widerrufst du jederzeit für die Zukunft, in deinem Konto oder per E-Mail; was bis dahin geschah, bleibt rechtmäßig. Für alles genügt eine formlose E-Mail an ",
          after: ".",
        },
        /** The Art. 21 DSGVO objection, set apart as Art. 21 (4) asks; a callout's text holds no link, so it names the address. */
        objection: {
          title: "Recht auf Widerspruch",
          text: `Jeder Verarbeitung auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO kannst du aus Gründen deiner besonderen Situation widersprechen (Art. 21 DSGVO); eine E-Mail an ${KONTAKT_EMAIL} genügt.`,
        },
        closing:
          "Automatisierte Entscheidungen im Sinne von Art. 22 DSGVO treffen wir nicht. Einen Datenschutzbeauftragten haben wir nicht bestellt. Beschweren kannst du dich bei einer Datenschutzaufsichtsbehörde, für uns beim Hessischen Beauftragten für Datenschutz und Informationsfreiheit, Postfach 3163, 65021 Wiesbaden.",
      },
      /** The notice's last paragraph: the day its words took effect. */
      stand: (day: CalendarDay) => `Stand: ${formatDateLong(day)}`,
    },

    legalNotice: {
      provider: { heading: "Anbieter", name: VEREIN_NAME, address: VEREIN_ADDRESS },
      representation: {
        heading: "Vertretung",
        rule: `Je ${formatNumber(VORSTAND_JOINTLY)} Mitglieder des Vorstands vertreten den Verein gemeinsam:`,
        member: (name: string, amt: string) => `${name}, ${amt}`,
      },
      /** Before the league's address, which the page sets as a link after it. */
      contact: { heading: "Kontakt", lead: "E-Mail: " },
      register: { heading: "Registereintrag", entry: VEREINSREGISTER },
      /** Before the repository's link, which the page sets after it under `link`. */
      licence: { heading: "Lizenz", lead: "Der Quellcode dieser Website steht unter der Elastic License 2.0: ", link: "Quellcode auf GitHub" },
    },
  },

  /** The application's public page where no form stands: a status card's title for each state, the day folded into it. */
  bewerbung: {
    end: {
      /** The landing's band alike, so the two pages say one thing of an upcoming window. */
      opensOn: (day: CalendarDay) => `Die Bewerbung öffnet am ${formatDateLong(day)}`,
      /** A paused window alike, the visitor being able to do nothing about either, and the landing's band, as `opensOn`. */
      closed: "Die Bewerbung ist gerade geschlossen",
      over: "Die Saison ist vorbei",
      none: "Keine Bewerbung für diese Saison",
      /** The outcome replacing the form, a replayed press alike. */
      submitted: "Bewerbung abgeschickt",
    },
  },

  /**
   * The fixed text of a contact person's confirmation page, `ROUTES.kontaktConfirmation`, titled
   * `COPY.page.entryConfirmation`: for whose application or team the person stands and as what, what is stored and until
   * when, what the birthdate is checked for, the deadline, what an objection does, and the privacy notice's link. The
   * Art. 21 objection with the league's address stands in the first-contact mail. The consents under it are
   * `fl_frontend/src/core/consentWordings.ts`'s; nobody accepts the notice, which informs and asks no consent.
   */
  kontaktConfirmation: {
    /** The title of a closed row's page, a past season's or a departed club's, which confirms nothing. */
    closedTitle: "Dein Eintrag",
    /** The fact naming the seat's own last day, in a list's date form; a closed row holds none. */
    confirmBy: "Bestätigen bis",
    /** The first sentence, by the record the seat stands on. */
    opening: {
      /** A seat in an application, one text for all: it names no submitter, the form recording none. */
      named: (schule: Words, saison: string, rolle: Words) =>
        `Du bist in der Bewerbung von ${textOf(schule)} für die ${COPY.shared.saisonName(saison)} als ${textOf(rolle)} genannt.`,
      /** Seated by the league on a team's season, with no application. */
      seasonRow: (team: Words, saison: string, rolle: Words) =>
        `Die Liga hat dich für ${textOf(team)} in der ${COPY.shared.saisonName(saison)} als ${textOf(rolle)} eingetragen.`,
    },
    stored: "Wir speichern deinen Namen, deine Kontaktdaten und dein Geburtsdatum längstens bis zum Ende der Saison danach.",
    /** The same on a closed row, whose seat no confirmation filled, so no birthdate stands on it. */
    closedStored: "Wir speichern deinen Namen und deine Kontaktdaten längstens bis zum Ende der Saison danach.",
    /** At the birthdate's field, by the seat's floor: Art. 13 asks the purpose where the date is asked. */
    ageCheck,
    /** The seat's own last day: an application goes whole when one of its seats lapses. */
    applicationDeadline,
    /** The deadline of a seat on a team's season, which goes alone. */
    seatDeadline: entryDeadline,
    /** At the objection's control, read before the press, by the record the seat stands on. */
    objectionEffect: {
      application: "Widersprichst du, entfernen wir deine Angaben aus der Bewerbung.",
      seasonRow: OBJECTION_DELETES_ENTRY,
    },
    /** Why a closed row's page confirms nothing, a club out of the season; a past season's is `refusalLine.saison_past`. */
    teamDeparted: (team: Words) => `${textOf(team)} ist aus der Saison ausgeschieden.`,
    /** The last line, around the privacy notice's title, which the page sets as its link. */
    more: MORE,
    /** The page's one paragraph, its sentences in reading order, each chosen by the seat's record and row. */
    text: (...sentences: Copy[]) => sentences.join(" "),
  },

  /**
   * The two ends of an entry's answer, on a contact person's page and a referee's alike, each a title; a link opened
   * again after it titles it with the day (`COPY.shared.end.doneOn`).
   */
  entryConfirmation: {
    confirmed: "Eintrag bestätigt",
    objected: "Widersprochen",
  },

  /**
   * The fixed text of a referee's confirmation page, `ROUTES.schiedsrichterConfirmation`: who named the person and for
   * what, what is stored and until when, the deadline, and what an objection does, the page's one sentence before its
   * two acts. The age floor is the birthdate field's bound, read off the link's view; the Art. 21 objection with the
   * league's address stands in the first-contact mail, and each consent's line names the privacy notice.
   */
  schiedsrichterConfirmation: {
    /** The page's and the mail's first sentence. */
    opening: REFEREE_OPENING,
    /** The deadline in the two parts around its day: the mail sets the day semibold, the page writes it plain. */
    deadline: ENTRY_DEADLINE,
    /** Both answers that end the entry, an unanswered deadline and an objection, in one clause: either deletes it alike. */
    question: (until: CalendarDay) =>
      `${REFEREE_OPENING} ${REFEREE_STORED} ${ENTRY_DEADLINE.before} ${formatDateLong(until)} oder widersprichst du${ENTRY_DEADLINE.after}`,
  },

  // Session 8: its page reads these.
  /**
   * The fixed text of a pupil's confirmation page, `ROUTES.registrierungConfirmation`, built as `kontaktConfirmation`
   * is: the registration the pupil made, what is stored and until when, the deadline, what the birthdate is checked
   * for, the objection and the privacy notice's link.
   */
  registrierungConfirmation: {
    opening: (team: Words, saison: string) =>
      `Du hast dich über den Link von ${textOf(team)} für den Kader in der ${COPY.shared.saisonName(saison)} registriert.`,
    stored:
      "Wir speichern deinen Namen, deine E-Mail-Adresse, dein Geburtsdatum und, wenn du sie angegeben hast, Rückennummer, Position und Stufe, längstens bis zum Ende der Saison danach.",
    ageCheck,
    deadline: (until: CalendarDay) => `Bestätigst du nicht bis zum ${formatDateLong(until)}, löschen wir deine Registrierung.`,
    more: MORE,
  },

  /**
   * Each listed page's meta description, by its route key, as a search result shows it under the title. Exactly
   * one for every row `ROUTES` lists and none for any other: a signed-in page, a sign-in page or one a mail opens
   * carries none, and a description set nowhere is not inherited from the root either.
   */
  description: {
    home: COPY.brand.description,
    about: `Wer in der ${COPY.brand.name} spielt, nach welchen Regeln und wofür, und wer die Liga organisiert.`,
    spielplan: (saison: string) =>
      `Alle Spiele der ${COPY.shared.saisonName(saison)} der ${COPY.brand.name}, Spieltag für Spieltag, mit Datum, Uhrzeit und Ort.`,
    tabelle: (saison: string) =>
      `Die Tabelle der ${COPY.shared.saisonName(saison)} der ${COPY.brand.name}: jede Gruppe mit Spielen, Toren und Punkten.`,
    teams: (saison: string) => `Alle Teams der ${COPY.shared.saisonName(saison)} der ${COPY.brand.name}, mit Gruppe und Kader.`,
    team: (team: string, saison: string) => `${team} in der ${COPY.shared.saisonName(saison)} der ${COPY.brand.name}: Stand, Spiele und Kader.`,
    kORunde: (saison: string) => `Die K.-o.-Runde der ${COPY.shared.saisonName(saison)} der ${COPY.brand.name}: der K.-o.-Baum bis zum Finale.`,
    spiel: (team1: Words, team2: Words, saison: string) =>
      `${COPY.page.spiel(team1, team2)} in der ${COPY.shared.saisonName(saison)} der ${COPY.brand.name}: Termin, Ort, Ergebnis und Aufstellungen.`,
    contact: `Die ${COPY.brand.name} erreichst du per E-Mail, auf Instagram und auf Threads.`,
    sponsors: `Die Sponsoren der ${COPY.brand.name}, und wie du die Liga unterstützen kannst.`,
    legalNotice: `Anbieterkennzeichnung der ${COPY.brand.name} nach § 5 DDG.`,
    privacyNotice: `Welche Daten die ${COPY.brand.name} verarbeitet, auf welcher Grundlage und wie lange.`,
    sitemap: `Alle Seiten der ${COPY.brand.name} auf einen Blick.`,
  } satisfies Record<ListedRoute, string | ((...names: never) => string)>,
});
