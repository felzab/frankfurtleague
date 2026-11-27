import "server-only";

import { KONTAKT_EMAIL, VEREIN_ADDRESS, VEREIN_NAME, VEREINSREGISTER, VORSTAND_JOINTLY } from "./brand";
import { boundBy, catalogue, lineOf, runsText, seatsText, spieleNamed, textOf, waitWords } from "./copy";
import { ACCOUNT_COPY } from "./copy/account";
import { ADMIN_COPY } from "./copy/admin";
import { COPY } from "./copy/shared";
import { formatDate, formatDateLong, formatDayAndTime, formatInstant, formatNumber, formatOrdinal, formatSigned } from "./format";

import type { Copy, TextLink, Wait, Words } from "./copy";
import type { CalendarDay, TimeOfDay } from "./format";
import type {
  Code,
  FLBookingResource,
  FLCardColour,
  FLGrantDataChange,
  FLGrantDataStage,
  FLKontaktSeat,
  FLOverviewCardName,
  FLRefusedField,
  FLSpielberichtOpenState,
  Rule,
} from "./generated/client/types";
import type { ROUTES } from "./routes";

/** The route keys of the pages a search engine may list. */
type ListedRoute = { [Key in keyof typeof ROUTES]: (typeof ROUTES)[Key]["crawl"] extends "index" ? Key : never }[keyof typeof ROUTES];

const { team1, team2 } = COPY.shared.teamPair;
const ownerTier = COPY.shared.owner;

const PLATZ = "Platz";
const TEAM = "Team";
const DIFFERENZ = "Diff.";
const SPIELE_SHORT = "Sp.";
const SPIELBETRIEB = "Spielbetrieb";
const gruppeName = COPY.shared.season.gruppe;
const placeName = (platz: number) => `${formatOrdinal(platz)} ${PLATZ}`;

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
// An address the ban list holds, named by a handover, which holds no box for it.
const ADDRESS_BARRED = "Diese E-Mail-Adresse steht auf der Sperrliste.";
// An address the administration holds, named by a path rather than typed: an erasure's or an address change's.
const ADDRESS_OF_ADMINISTRATION = "Diese Adresse gehört zur Verwaltung.";
const ADDRESS_CONFIRMED = "Adresse bestätigt";

// The confirmation pages' shared sentences, each written once: what the typed birthdate is checked for, the deadline
// of an entry that goes alone, the objection Art. 21 (4) asks to be named explicitly, around the league's address, and
// the privacy notice's link, around its title.
const ageCheck = (minAge: number) => `Mit deinem Geburtsdatum prüfen wir, ob du mindestens ${boundBy(formatNumber(minAge), "Jahre")} alt bist.`;
// Around its day, which a mail sets semibold and a page writes in the sentence's weight (`runsText`).
const entryDeadline = (day: string) => ["Bestätigst du nicht bis zum ", { strong: day }, ", löschen wir deinen Eintrag."] as const;
// The same in an application, where any seat's lapse takes the whole application with it, so the deletion names no day:
// another seat's earlier day can overtake the reader's own.
const applicationDeadline = (day: string) =>
  ["Bestätige bis zum ", { strong: day }, ". Bestätigt eine Kontaktperson nicht rechtzeitig, löschen wir die Bewerbung."] as const;
// The same in a pupil's registration, which goes alone.
const registrationDeadline = (day: string) => ["Bestätigst du nicht bis zum ", { strong: day }, ", löschen wir deine Registrierung."] as const;
// Around the league's address, which a mail sets as its address and a page as its link.
const objectionRight = <Contact>(contact: Contact) =>
  [
    "Du kannst der Verarbeitung deiner Angaben jederzeit widersprechen, aus Gründen, die sich aus deiner besonderen Situation ergeben (Art.\u00A021 DSGVO). Eine formlose E-Mail an ",
    contact,
    " genügt.",
  ] as const;
// Around the privacy notice's link, which the page draws.
const more = (link: TextLink) => ["Mehr unter ", link, "."] as const;
// What an objection does to a contact's seat on a season row and to a referee's entry, each erased in its own write.
const OBJECTION_DELETES_ENTRY = "Widersprichst du, löschen wir deinen Eintrag.";
// A referee's confirmation's opening, which its mail opens on too, and what the league stores of the entry.
const REFEREE_OPENING = "Die Liga hat dich als Schiedsrichterin oder Schiedsrichter für ihre Spiele eingetragen.";
const REFEREE_STORED =
  "Wir speichern deinen Namen, deine Kontaktdaten, dein Honorar, dein Geburtsdatum und deine Schule, wenn sie angegeben ist, bis du oder die Liga den Eintrag beendet.";

/**
 * The bounds the code holds that the privacy notice's retention table states, the frontend's and the ones the backend
 * publishes, passed by its page. An hour read „1 Stunde“ is typed as its one figure, the singular being the sentence's.
 */
type RetentionBounds = {
  bewerbungDays: number;
  registrierungDays: number;
  declinedDays: number;
  schiedsrichterDays: number;
  addressChangeLinkHours: number;
  code: { minutes: number; mailHours: 1; failureHours: number };
  /** The days a session's row stands past its last use, which the library's sliding expiry and the TTL index keep. */
  sessionDays: number;
  /** How many seasons after its own a ban runs, the backend's `BAN_DURATION_SAISONS`. */
  banSaisons: number;
  /** The days an ended address change's record stands. */
  addressChangeRetentionDays: number;
  /** The years the Protokoll keeps a row, which the table states in months. */
  actionLogYears: number;
  /** The days a sent or given-up mail's row stands. */
  outboxRetentionDays: number;
};

/** A period of whole years as the notice states it, in months: the Protokoll's year reads „12 Monate“. */
const monthsOf = (years: number) => formatNumber(12 * years);

/**
 * The catalogue's entries only the server reads, so no client bundle carries them: a bundler keeps all of an object a
 * client module imports, so an audience's catalogue under `copy/` holds only what a client component reads. Branded as
 * those are, so an entry passes wherever a `Copy` is asked for.
 */
export const SERVER_COPY = catalogue({
  /**
   * A refusal's sentence on the status line, by the backend's code, on every screen whose write answers it: a gate,
   * which names no box, or a field's fault on a screen showing no box for that field, such as the adoption of a
   * proposed date, which moves a fixture from a row. A fault on a box the screen shows takes its field phrase, so a
   * code raised only on boxes every screen shows holds no sentence. Where one code is about one of several fields, its
   * sentence is keyed by the first name of the path the backend names, so it says which; a path it holds no sentence
   * for reads the stale-page line. A sentence naming the bounds its refusal carries is a function of them, answering
   * `undefined` where one it names is missing.
   */
  refusalLine: {
    saison_past: "Diese Saison ist abgeschlossen.",
    spiel_outside_spieltag: "Dieses Datum liegt außerhalb des Spieltags.",
    state_nichtantreten_without_two_sides: "Beide Teams stehen noch nicht fest.",
    /** A result, a no-show or an abandonment saved before the season's start, which a match editor read since locks. */
    ergebnis_before_saison_start: "Die Saison hat noch nicht begonnen.",
    /**
     * A retired venue or referee a fixture keeps where its save reopens it, which the editor shows marked: a deleted one
     * is a page read before the deletion, which the same sentence sends to the same box.
     */
    booking_unknown_resource: {
      spielort: "Der Spielort ist stillgelegt.",
      schiedsrichter: "Die eingeteilte Person ist stillgelegt.",
    },
    spiel_double_booked: DOUBLE_BOOKED,
    /** The owner's own deletion, on `/erasure` and in Konto: the handover frees the account first. */
    owner_erasure: `Mit der ${ownerTier} lässt sich das Konto nicht löschen.`,
    /** An administrator's own address, which only Konto changes or deletes. */
    own_address: "Für deine eigene Adresse geht das nur im Konto.",
    /** A holder's address, one sentence on an erasure and an address change alike, where a path names the address. */
    admin_address: ADDRESS_OF_ADMINISTRATION,
    foreign_address_change: ADDRESS_OF_ADMINISTRATION,
    /** A ban's last season counts from the running one. */
    ban_list_no_saison: "Es läuft keine Saison.",
    /** An address change's start, for an address holding no record. */
    address_change_nothing: COPY.shared.nothingAtAddress,
    /** The new address another person stands at, a pupil, an entry or a grant, on the re-send, which holds no box. */
    address_change_taken: "Die neue Adresse ist schon vergeben.",
    /** A person's own start pressed again too soon after the last mail its change owed: the edge's own rate refusal. */
    address_change_started_recently: COPY.shared.failure.tooManyAttempts,
    /** A venue retired while matches still to come are booked there, named by their numbers so they can be moved first. */
    spielort_still_booked: ({ spiel_nrs }: FLRefusedField["ctx"]) =>
      Array.isArray(spiel_nrs) && spiel_nrs.length > 0 ? `Der Spielort ist noch für ${spieleNamed(spiel_nrs)} gebucht.` : undefined,
    /** A referee retired while matches still to come name them, by the matches' numbers. */
    schiedsrichter_still_assigned: ({ spiel_nrs }: FLRefusedField["ctx"]) =>
      Array.isArray(spiel_nrs) && spiel_nrs.length > 0 ? `Die Person ist noch für ${spieleNamed(spiel_nrs)} eingeteilt.` : undefined,
    /** A handover naming an address the ban list holds. */
    grant_barred: ADDRESS_BARRED,
    /** A club the form or the acceptance picked that already stands in the season. */
    bewerbung_picked_team_already_entered: "Diese Schule spielt in dieser Saison schon mit.",
    /** A seat write or a fresh link for a seat erased at its person's request, which its row marks „Gelöscht“. */
    bewerbung_seat_erased: "Dieser Sitz ist gelöscht.",
    /**
     * A club retired since the page offering its entry was read: an application's acceptance, a club entered into the
     * season, or the incoming club of a replacement.
     */
    team_retired: "Das Team ist stillgelegt.",
    /** A reactivated squad row past the season's cap, and an admission into a squad that filled meanwhile. */
    kader_full: "Der Kader ist voll.",
    /** A squad row's return whose role another live row took since the page offered it: the press shows no role box. */
    kader_rolle_taken: "Die Rolle ist schon vergeben.",
    /** An admission of a pupil a squad of the season holds already. */
    registrierung_already_in_kader: "Die Person steht schon in einem Kader.",
    /** An admission whose registered Stufe the season stopped offering after the pupil registered. */
    registrierung_stufe_not_allowed: "Diese Stufe ist in dieser Saison nicht zugelassen.",
    /** A proposed day that has gone by: on the club's decline, and on „Übernehmen“, which would move the fixture into it. */
    ansetzung_vorschlag_past: "Der vorgeschlagene Tag ist vorbei.",
    /** A club's decline proposing the day and hour the fixture holds. */
    ansetzung_vorschlag_unchanged: "Das ist der angesetzte Termin.",
    /** A line-up's save by a seat once the lock has passed, one naming more nominees than the eleven lack, and one for a fixture holding no day or hour. */
    aufstellung_locked: "Die Aufstellung ist gesperrt.",
    aufstellung_nominee_without_shortage: ({ max }: FLRefusedField["ctx"]) =>
      typeof max === "number" ? `Nachnominierte füllen nur die Lücke bis ${formatNumber(max)}.` : undefined,
    aufstellung_spiel_undated: "Das Spiel hat noch keinen Termin.",
    // A season's rules, a fact the person reads off the season editor itself. An act the read locks says its lock as its
    // tooltip instead, so a press on a page read before the lock reads the stale-page line.
    rules_bracket_impossible: ADMIN_COPY.saison.bracketImpossible,
    eligibility_disqualified: DISQUALIFIED,
    /**
     * A save after which the bracket would field one club in two matches of one matchday, a club picked by hand
     * standing where the bracket's own wiring leads it too: the same save answers the same, the page being current.
     */
    spieltag_occupied_by_the_resolution: "Ein Team spielt dann zweimal an diesem Spieltag.",
    /**
     * A fixture's save, the match editor's or „Übernehmen“'s, that would delete a later result it was not confirmed
     * to delete, one entered or changed since the question was asked among them: the match editor asks again.
     */
    voided_results_stale: ADMIN_COPY.overview.voidsLater,
  } satisfies Partial<Record<Code, string | Readonly<Record<string, string>> | ((context: FLRefusedField["ctx"]) => string | undefined)>>,

  /**
   * A rule's sentence on the status line, by the kind the backend refuses a payload with (`fields[].kind`), for a
   * rule a person can break that no field pattern words: placed as `refusalLine` places a code. Every rule a pattern
   * words is worded by its field pattern.
   */
  ruleLine: {
    elfmeterschiessen_without_winner: "Das Elfmeterschießen hat keinen Sieger.",
  } satisfies Partial<Record<Rule, string>>,

  /**
   * What an act's server action answers on its own, beside the refusals the catalogue words by their code: a refusal
   * of its own check, or a note on an act done in part, by the act's record.
   */
  actAnswer: {
    /** An administrator's last passkey, their only way into the administration. */
    lastPasskeyKept: "Der letzte Passkey lässt sich nicht löschen.",
    /** The erasure's note, the account undeleted or unknown: the form keeps the address, so its „Löschen“ retries. */
    erasurePartial: "Die Daten sind gelöscht, das Konto vielleicht nicht.",
    withdrawal: {
      noneChosen: "Kein Widerruf gewählt.",
      /** No record at the address grants a ticked choice, none at all included. */
      nothingGranted: "Unter dieser Adresse ist nichts davon erteilt.",
    },
  },

  /** The image a shared link's preview shows, by its alt, which a screen reader reads in the preview's place. */
  shareImage: {
    alt: `${COPY.brand.name}, die Fußballliga der Frankfurter Oberstufen: der Pokal über dem Schriftzug`,
  },

  /**
   * What is open, in one set of words wherever open work is listed: the cards by the names the read serves them under,
   * and each row's line by the kind of open work.
   */
  overview: {
    card: {
      due: "Heute und überfällig",
      ergebnisse: "Ergebnisse",
      dates: "Termine",
      bewerbungen: COPY.page.adminBewerbungen,
    } satisfies Record<FLOverviewCardName, string>,
    answerDue: "Antwort heute fällig",
    /** What a fixture lacks, by its own word: „Termin“, or the label its box carries in the match editor. */
    missing: (label: Copy) => `${label} fehlt`,
    report: {
      proposed: "Spielbericht nicht übernommen",
      differing: "Spielbericht weicht vom Ergebnis ab",
      sides_changed: "Spielbericht nennt andere Teams",
    } satisfies Record<FLSpielberichtOpenState, string>,
    /** A club's proposed date and hour, as a match row writes them; a club the fixture no longer fields is not named. */
    proposal: (when: Copy, team: Words | null) => (team === null ? `Schlägt ${when} vor` : `${textOf(team)} schlägt ${when} vor`),
    seatsConfirmed: (confirmed: number, seats: number) =>
      confirmed === seats
        ? "Alle Kontaktpersonen bestätigt"
        : `${formatNumber(confirmed)} von ${boundBy(formatNumber(seats), "Kontaktpersonen")} bestätigt`,
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
      departed_occupant: (team: Words, austritt: Copy) => lineOf([textOf(team), austritt]),
      fielded_twice: (team: Words) => `${textOf(team)} zweimal an diesem Spieltag`,
      /** By the booking's object, „Spielort“ or „Schiedsrichter“. */
      retired_booking: (booking: Copy) => `${booking} stillgelegt`,
      double_booked: { spielort: "Spielort doppelt belegt", schiedsrichter: "Schiedsrichter doppelt eingeteilt" } satisfies Record<
        FLBookingResource,
        string
      >,
    },
    adoptConsequence: "Das Spiel wird verlegt.",
    discardConsequence: "Der Termin bleibt.",
  },

  mail: {
    greeting: "Hallo,",
    buttonLink: "Falls der Knopf nicht geht, öffne diesen Link:",
    /** The Art. 21 DSGVO objection, set apart from the rest as Art. 21 (4) asks, around the league's address. */
    objection: (address: string) => objectionRight({ address }),
    /** The mail's last line, by its kind: what a reader the mail was not meant for does. */
    notYou: {
      signIn: "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail.",
      security: "Stimmt das nicht? Dann antworte sofort auf diese E-Mail.",
      firstContact: "Du weißt nichts davon? Dann antworte auf diese E-Mail, und wir löschen deine Angaben.",
    },

    linkValidFor: (hours: number) => `Der Link gilt ${boundBy(formatNumber(hours), "Stunden")}.`,

    /**
     * The fixture mails: a club asked to confirm a fixture's slot, a referee booked onto it, and the word of what became
     * of either. Each subject names the day; a sentence's moment is set semibold.
     */
    spiel: {
      /** The mail by the name the notices give it, „Anfrage“: a subject naming one answer would pass over the other. */
      requestSubject: (day: CalendarDay) => `Anfrage: Spieltermin am ${formatDateLong(day)}`,
      reminderSubject: (day: CalendarDay) => `Erinnerung: Spieltermin am ${formatDateLong(day)}`,
      /** Both answers named before the press, as the page offers both. */
      confirmAsk: (team: Words) => `Sag den Termin für ${textOf(team)} zu oder schlag einen anderen vor.`,
      answerMissing: (team: Words) => `Die Antwort von ${textOf(team)} fehlt noch.`,
      answerUntil: (day: string) => ["Antworte bis zum ", { strong: day }, "."] as const,
      /** Any seat of the club answers, and the first answer binds the club. */
      firstAnswerCounts: "Es gilt die erste Antwort aus deinem Team.",

      /** A move, by the day the fixture moved to, or by the day it left where it holds no new one yet. */
      movedSubject: (day: CalendarDay) => `Verlegt: Spiel auf den ${formatDateLong(day)}`,
      movedFromSubject: (day: CalendarDay) => `Verlegt: Spiel am ${formatDateLong(day)}`,
      moved: (spiel: Words) => `${textOf(spiel)} ist verlegt.`,
      /** A new pairing at the slot the fixture keeps, by the new pairing: the change a club or a referee is told of. */
      newPairing: (spiel: Words) => `Am selben Termin spielt jetzt ${textOf(spiel)}.`,
      /**
       * The block's rows of a move, beside the slot's own: the moment it left and the one it moved to, in the words
       * „Übernehmen“'s question names them by.
       */
      previous: COPY.shared.facts.before,
      next: COPY.shared.facts.after,
      /** The moment a move left, where the move also changed the sides: the pairing that slot held, then the moment. */
      previousPairing: (spiel: Words, moment: string) => `${textOf(spiel)}, ${moment}`,
      /** A club taken off a fixture it was asked about, around the moment it was asked about. */
      voidSubject: (day: CalendarDay) => `Nicht mehr angefragt: Spiel am ${formatDateLong(day)}`,
      void: (spiel: Words, moment: string) => [`Die Anfrage zu ${textOf(spiel)} am `, { strong: moment }, " gilt nicht mehr."] as const,

      /**
       * A match that will not be played, by its event in the word the match page names it by, around its moment: a
       * no-show names the side that stayed away.
       */
      cancelled: {
        ausgefallen: {
          subject: (day: CalendarDay) => `${COPY.spielplan.sonderereignis.ausgefallen}: Spiel am ${formatDateLong(day)}`,
          lead: (spiel: Words, moment: string) => [`${textOf(spiel)} am `, { strong: moment }, " fällt aus."] as const,
        },
        annulliert: {
          subject: (day: CalendarDay) => `${COPY.spielplan.sonderereignis.annulliert}: Spiel am ${formatDateLong(day)}`,
          lead: (spiel: Words, moment: string) => [`${textOf(spiel)} am `, { strong: moment }, " ist annulliert."] as const,
        },
        nichtantreten: {
          subject: (day: CalendarDay) => `${COPY.spielplan.sonderereignis.nichtantretenChip}: Spiel am ${formatDateLong(day)}`,
          lead: (team: Words, moment: string) => [`${textOf(team)} tritt zum Spiel am `, { strong: moment }, " nicht an."] as const,
        },
      },

      /** The referee's Einteilung, which they answer on their own Übersicht, signed in. */
      bookedSubject: (day: CalendarDay) => `Einteilung: Spiel am ${formatDateLong(day)}`,
      booked: (spiel: Words) => `Du pfeifst ${textOf(spiel)}.`,
      /** The decline in the word its button and its chip carry, „Ablehnen“ and „Abgelehnt“. */
      sayYesOrNo: "Sag zu oder lehne ab.",
      /** A referee taken off a fixture, around the moment they were booked for. */
      unbookedSubject: (day: CalendarDay) => `Nicht mehr eingeteilt: Spiel am ${formatDateLong(day)}`,
      unbooked: (spiel: Words, moment: string) => [`Du pfeifst ${textOf(spiel)} am `, { strong: moment }, " nicht mehr."] as const,

      /** A club's proposal the league discarded, around the moment that stands. */
      keptSubject: (day: CalendarDay) => `Termin bleibt: Spiel am ${formatDateLong(day)}`,
      kept: (spiel: Words, moment: string) => [`${textOf(spiel)} bleibt am `, { strong: moment }, "."] as const,
    },

    /**
     * The one reminder a team's confirmed seats get while a match's line-up is missing, on the fixture reminder's
     * pattern: the match's block between its two sentences.
     */
    aufstellung: {
      reminderSubject: (day: CalendarDay) => `Erinnerung: Aufstellung für den ${formatDateLong(day)}`,
      missing: (team: Words) => `Die Aufstellung von ${textOf(team)} fehlt noch.`,
      dueUntil: (moment: string) => ["Trag sie bis zum ", { strong: moment }, " ein."] as const,
    },

    /**
     * An opponent's word that a club left the season, its lead opening on the club's name, set semibold. A subject naming
     * a team names it last, as every mail's does: a name runs to 60 characters, and a cut subject keeps what it is about.
     */
    austrittNotice: {
      subject: (team: string) => `Ausgeschieden: ${team}`,
      lead: (team: string, saison: string) => [{ strong: team }, ` ist aus der ${COPY.shared.saisonNameBound(saison)} ausgeschieden.`] as const,
      /** A match row's label, with its year as every other mail's date has it; undated, what is still to settle. */
      when: (day: CalendarDay | null, time: TimeOfDay | null) =>
        day === null ? COPY.spielplan.when(null, null) : time === null ? formatDateLong(day) : formatDayAndTime(day, time),
    },

    /**
     * An application's mails. A link mail names no submitter, the form recording none, and no school, which anyone sending
     * the form types. A lead sets the name it holds semibold.
     */
    bewerbung: {
      confirmOrOppose: "Bestätige deinen Eintrag oder widersprich ihm.",
      /** Around its day, as `schiedsrichterConfirmation.deadline`. */
      deadline: (day: string) => applicationDeadline(day),
      registeredAs: "Eingetragen als",
      status: "Stand der Bewerbung",

      /**
       * The Ansprechperson's link mail. It says an application came in, never that the reader sent it, and names no
       * school and no person: behind a mistyped address a stranger learns nobody's name.
       */
      received: {
        subject: (saison: string) => `Bewerbung für die ${COPY.shared.saisonName(saison)} eingegangen`,
        lead: (saison: string) => `Für die ${COPY.shared.saisonNameBound(saison)} ist eine Bewerbung eingegangen.`,
        named: (seats: readonly FLKontaktSeat[]) => `Darin bist du als ${seatsText(seats)} genannt.`,
        others: "Die anderen Kontaktpersonen bestätigen selbst. Sag ihnen Bescheid.",
        pending: "Noch offen",
      },
      /**
       * A seat's link mail, and the fresh link „Sitz bearbeiten“ mails: each seat holds its own days, so it says one day
       * alone. It opens on its page's opening, `kontaktConfirmation.opening.named`, as every confirmation mail does.
       */
      link: {
        subject: (saison: string) => `${COPY.page.entryConfirmation}: ${COPY.shared.saisonName(saison)}`,
      },
      reminder: {
        subject: (saison: string) => `Erinnerung: Eintrag für die ${COPY.shared.saisonName(saison)}`,
        missing: "Deine Antwort fehlt noch.",
      },
      zusage: {
        subject: (saison: string) => `Zusage für die ${COPY.shared.saisonName(saison)}`,
        /** The first sentence, the preview, opening on the club's name; the welcome stands apart from it. */
        lead: (team: string, saison: string) => [{ strong: team }, ` spielt in der ${COPY.shared.saisonNameBound(saison)}.`] as const,
        welcome: "Herzlich willkommen.",
        fixed: "Gruppe und Trikotfarbe stehen fest.",
        /** No later mail names a colour set after the Zusage, so none is promised. */
        fixedNoColour: "Die Gruppe steht fest.",
        signIn: "Melde dich mit dieser Adresse an, dort findest du dein Team.",
      },
      absage: {
        subject: (saison: string) => `Absage für die ${COPY.shared.saisonName(saison)}`,
        lead: (team: string, saison: string) =>
          ["Danke für die Bewerbung von ", { strong: team }, ` für die ${COPY.shared.saisonNameBound(saison)}.`] as const,
        decision: "In dieser Saison können wir das Team nicht aufnehmen.",
        /** After `decision`: the decline stands as the application's deletion notice, so no second mail follows. */
        deletion: (days: number) => `Die Bewerbung löschen wir in ${boundBy(formatNumber(days), "Tagen")}.`,
        title: "Die Absage",
      },
      erasure: {
        subject: (saison: string) => `Bewerbung für die ${COPY.shared.saisonName(saison)} gelöscht`,
        again: "Solange das Bewerbungsfenster offen ist, kann sich deine Schule neu bewerben.",
      },
      objection: {
        subject: (saison: string) => `Widerspruch zum Eintrag: ${COPY.shared.saisonName(saison)}`,
        lead: (seat: string) => ["Die Kontaktperson als ", { strong: seat }, " hat dem Eintrag widersprochen."] as const,
        // No pronoun: „Diese Angaben“ reads correctly for every seat.
        removed: "Diese Angaben haben wir aus der Bewerbung entfernt.",
        replace: "Soll eine andere Person übernehmen, antworte auf diese E-Mail.",
        /** Around the last day it stands, the deletion coming once that day has passed. */
        until: (day: string) => ["Sonst löschen wir die Bewerbung nach dem ", { strong: day }, "."] as const,
        from: "Widerspruch von",
      },
    },

    /** A seat on a team's season: its sentences are the confirmation page's, `kontaktConfirmation`. */
    kontakt: {
      subject: (team: string) => `${COPY.page.entryConfirmation}: ${team}`,
      /** A closed row's subject and button, which have nothing to confirm. */
      closedSubject: (team: string) => `Dein Eintrag für ${team}`,
      toEntry: "Zum Eintrag",
    },

    /** The sign-in code: no button, since a link carrying the code would sign in whoever opened a forwarded mail. */
    signInCode: {
      subject: "Dein Anmeldecode",
      lead: "Mit diesem Code meldest du dich an:",
      validity: (minutes: number) => `Er gilt ${boundBy(formatNumber(minutes), "Minuten")} und nur einmal.`,
      /** Around the host the code is typed on, set semibold. */
      onlyHere: (host: string) => ["Gib ihn nur auf ", { strong: host }, " ein."] as const,
    },

    /** A passkey set up or deleted, around the moment, set semibold. */
    passkeyAdded: {
      subject: "Passkey eingerichtet",
      lead: (moment: string) => ["Am ", { strong: moment }, " wurde in deinem Konto ein Passkey eingerichtet."] as const,
    },
    passkeyRemoved: {
      subject: "Passkey gelöscht",
      lead: (moment: string) => ["Am ", { strong: moment }, " wurde in deinem Konto ein Passkey gelöscht."] as const,
      devices: "Geräte, die damit angemeldet waren, sind abgemeldet.",
    },

    /** The deletion link: the subject and the button are the act's own words, `COPY.page.accountErasure`. */
    erasureLink: {
      lead: "Du hast angefordert, dein Konto zu löschen.",
      /** The deletion box's own sentence, so the box and its mail point alike to where what outlives the deletion is listed. */
      consequence: ACCOUNT_COPY.erasure.description,
    },

    /**
     * An address change: the address on file's request, then the new address's, and the two notices of its end, sent on
     * every way a change takes.
     */
    addressChange: {
      /** The address on file's request opens on the page's question; the subject is its button's act. */
      previousEffect: "Sie gilt, sobald beide Adressen sie bestätigt haben.",
      /** To the replaced address, around the moment, set semibold. */
      effective: {
        subject: "E-Mail-Adresse geändert",
        lead: (moment: string) => ["Seit ", { strong: moment }, " gilt für dein Konto eine neue E-Mail-Adresse."] as const,
      },
      /** To the new address, whose confirmed change did not take effect: never why, since its holder may be a stranger. */
      discarded: { subject: "E-Mail-Adresse nicht geändert", lead: "Für dein Konto gilt weiter die bisherige Adresse." },
      administrator: {
        lead: "Die Verwaltung hat diese E-Mail-Adresse für ein Konto eingetragen.",
        noticeSubject: "Deine E-Mail-Adresse soll sich ändern",
        noticeLead: "Die Verwaltung hat eine neue E-Mail-Adresse für dich eingetragen.",
        noticeWait: (wait: Wait) => `Sie gilt erst ${waitWords(wait).span}, nachdem sie bestätigt ist.`,
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
      ends: (saison: string) => `Die Sperre endet nach der ${COPY.shared.saisonNameBound(saison)} von selbst.`,
      stored: "In der Sperrliste stehen deine Adresse, der Grund und das Datum.",
      account:
        "Dein Konto bleibt, solange unter dieser Adresse ein Eintrag bei uns besteht. Die Sperre bleibt auch nach einer Löschung bis zu ihrem Ende.",
      basis:
        "Wir speichern das auf Grundlage unseres berechtigten Interesses, den Spielbetrieb vor Störungen zu schützen (Art.\u00A06 Abs.\u00A01 lit.\u00A0f DSGVO).",
      rights: (address: string) =>
        [
          "Für eine Kopie deiner Daten, ihre Löschung, den Widerruf einer Einwilligung oder Fragen zur Sperre schreib uns an ",
          { address },
          ".",
        ] as const,
    },

    /** The notice to every holder and the person named, one body for every reader, by what changed. */
    grant: {
      subject: {
        granted: "Neuer Zugang zur Verwaltung",
        handover: `Übergabe der ${ownerTier} angekündigt`,
        address: "Neue Adresse in der Verwaltung",
        revoked: "Zugang zur Verwaltung beendet",
        withdrawn: "Angekündigte Änderung zurückgezogen",
        /** An addition holds from its start and a removal names its own, so only these two complete what they announced. */
        completed: {
          handover: `Übergabe der ${ownerTier} gilt jetzt`,
          address: "Neue Adresse in der Verwaltung gilt jetzt",
        },
      } satisfies Record<FLGrantDataChange | Exclude<FLGrantDataStage, "started" | "completed">, string> & {
        completed: Record<Exclude<FLGrantDataChange, "granted" | "revoked">, string>;
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
        completed: {
          handover: (address: string) => `${address} leitet jetzt die Verwaltung.`,
          address: (previous: string, next: string) => `${previous} ist jetzt zu ${next} gewechselt.`,
        },
      },
      effectiveFrom: (moment: string) => `Die Änderung gilt ab ${formatInstant(moment)}.`,
      warn: `Stimmt das nicht, melde dich sofort bei der ${ownerTier}.`,
      button: "Zur Verwaltung",
      /** An erased person's address, in the subject's place. */
      unnamedAddress: "Eine nicht genannte Adresse",
      /** The same, as a lead's object after „an“. */
      unnamedTarget: "eine nicht genannte Adresse",
      /** An erased new address, after „zu“. */
      unnamedNewAddress: "einer nicht genannten Adresse",
    },

    /** The one notice of a deletion: an account's, or an application's that did not come about, to each seat that confirmed. */
    deletion: {
      /** The deletion box's own sentence, as its link's mail reads it: the subject already says the account is gone. */
      account: ACCOUNT_COPY.erasure.description,
      bewerbung: {
        // True of a lapse and of an application undecided at its season's end alike.
        lead: (saison: string) => `Die Bewerbung für die ${COPY.shared.saisonNameBound(saison)} kam nicht zustande.`,
        deleted: "Wir haben sie mit allen Angaben gelöscht.",
      },
    },

    /**
     * A team's registration link, to a confirmed contact seat: the link stands alone in the box, to be passed on
     * rather than pressed. It names no validity: the link opens a registration only while its season takes them, which
     * can start or pause after the mail.
     */
    invitation: {
      subject: (team: string) => `Registrierungslink: ${team}`,
      passOn: (saison: string, team: string) =>
        `Gib diesen Link an alle weiter, die in der ${COPY.shared.saisonNameBound(saison)} für ${team} spielen.`,
      key: "Wer den Link hat, kann sich für dein Team registrieren.",
      admission: "In den Kader kommt nur, wen dein Team aufnimmt.",
    },

    /**
     * A pupil's registration: its confirmation link, a first contact, whose lead and whose deadline by a day are the
     * confirmation page's own sentences (`registrierungConfirmation`), and the team's decline, a notice.
     */
    registrierung: {
      confirmation: {
        subject: (team: string) => `Registrierung bestätigen: ${team}`,
        admission: "Erst wenn du bestätigt hast, kann dein Team dich aufnehmen.",
        /** The page's deadline, around its day. */
        deadline: (day: string) => registrationDeadline(day),
      },
      absage: {
        subject: (team: string) => `Registrierung abgelehnt: ${team}`,
        /** The lead opens on the team's name, set semibold. */
        lead: (team: string, saison: string) =>
          [{ strong: team }, ` hat deine Registrierung für die ${COPY.shared.saisonNameBound(saison)} abgelehnt.`] as const,
        askTeam: "Fragen dazu beantwortet dein Team.",
        /** In `askTeam`'s place where the team answered that the address is another person's. */
        otherPerson: "Unter dieser Adresse steht schon eine andere Person.",
        registerAgain: "Registriere dich mit deiner eigenen Adresse neu.",
        /** The decline stands as the registration's deletion notice, as an application's does. */
        deletion: (days: number) => `Die Registrierung löschen wir in ${boundBy(formatNumber(days), "Tagen")}.`,
      },
    },
  },

  /**
   * The two pages a mail opens for the account, the address change's and the deletion's. The address change's two
   * mails open on these pages' questions.
   */
  addressChange: {
    /** The noun of the address on file's act, „Änderung bestätigen“: Konto's word for the pending change. */
    change: COPY.shared.addressChange.change,
    /** The address on file's question names the address the change goes to under Konto's label for it. */
    newAddress: COPY.shared.addressChange.new,
    previous: {
      question: "Für dein Konto soll eine neue E-Mail-Adresse gelten.",
      confirmed: "Änderung bestätigt",
      stopped: "Änderung gestoppt",
    },
    new: {
      question: `Diese Adresse soll künftig für ein Konto bei der ${COPY.brand.name} gelten.`,
      waits: (wait: Wait) => `Sie gilt erst ${waitWords(wait).span}, nachdem du sie bestätigt hast.`,
      confirmed: ADDRESS_CONFIRMED,
      confirmedFrom: (day: CalendarDay) => `${ADDRESS_CONFIRMED}, gilt ab ${formatDateLong(day)}`,
    },
    declined: "Änderung abgelehnt",
  },
  accountErasure: {
    question: "Alles oben wird endgültig gelöscht.",
    passkeys: COPY.shared.passkeys,
    addressChanges: COPY.shared.erasureCount.addressChanges,
    grant: COPY.shared.erasureCount.grant,
    done: ACCOUNT_COPY.erasure.done,
  },

  /**
   * The landing's sections and the blocks About, Kontakt and the sponsors page share with it, each read by a Server
   * Component.
   */
  landing: {
    tagline: "Frankfurts Abi-Jahrgänge spielen um den Titel",
    /**
     * The two paragraphs the league describes itself with, under the tagline and at the head of About: what the league
     * is, then who stands behind a team and who runs it.
     */
    paragraphs: [
      COPY.brand.description,
      "Hinter jedem Team steht eine ganze Schule, die zu den Spielen kommt und mitfiebert. Ehrenamtliche aus den Jahrgängen organisieren die Liga, von der Bewerbung bis zum Finale.",
    ],
    toBewerbung: "Zur Bewerbung",

    /** The league's short facts, each written once. */
    about: {
      who: {
        title: "Wer spielt",
        text: "Nur der Abi-Jahrgang, für den das Team antritt, in jeder Zusammensetzung. Lehrkräfte sind als Fans willkommen.",
      },
      rules: {
        title: "Die Regeln",
        text: "11 gegen 11 über 90\u00A0Minuten, bei jedem Wetter. Die Schiedsrichter kommen, soweit möglich, von außerhalb.",
      },
      purpose: { title: "Wofür", text: "Beide Teams verdienen an Tickets und am Verkauf vor Ort und teilen den Erlös." },
      spielorte: { title: COPY.page.adminSpielorte, text: "Kein zentraler Platz. Wo und wann ein Spiel stattfindet, steht im Spielplan." },
      admission: { title: "Eintritt", text: "2 bis 5\u00A0€, je nach Spiel. Im Vorverkauf meist günstiger." },
      safety: { title: "Sicherheit", text: "Bei den meisten Spielen sind Sanitäter vor Ort." },
    },

    pillars: { eyebrow: "Unser Ziel", title: "Fußball, der den Abiball bezahlt" },

    join: {
      eyebrow: "Bewerbung",
      title: "Der Weg in die Liga",
      apply: {
        title: "Bewerbung abschicken",
        text: "Schule, Stufe, die Kontaktpersonen und die geplante Kadergröße, solange das Fenster offen ist.",
      },
      confirm: {
        title: "Kontaktpersonen bestätigen",
        text: (days: number) =>
          `Jede Kontaktperson bestätigt ihren Eintrag innerhalb von ${boundBy(formatNumber(days), "Tagen")} über einen eigenen Link.`,
      },
      decision: {
        title: "Zusage der Liga",
        text: "Wir prüfen die Bewerbung und sagen zu oder ab. Mit der Zusage ist deine Schule Teil der Saison.",
      },
      register: {
        title: "Spieler registrieren",
        text: "Dein Team bekommt einen Link, über den sich dein Jahrgang registriert. Die Kontaktpersonen nehmen die Spieler in den Kader auf.",
      },
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
      schulen: COPY.shared.schulen,
      spiele: COPY.page.spiele,
      tore: COPY.shared.tore,
    },

    organisers: {
      eyebrow: "Organisation",
      title: "Wer dahintersteht",
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
      support: "Du willst die Liga unterstützen",
    },

    schools: { eyebrow: "Wer dabei ist", title: (saison: string) => `Schulen der ${COPY.shared.saisonName(saison)}` },

    saison: {
      opening: (when: Copy) => `Anpfiff ${when}`,
      spieltag: COPY.shared.spieltag,
      windowUntil: (until: CalendarDay) => `Bewerbungen bis ${formatDate(until)}`,
      last: "Zuletzt",
      next: "Als Nächstes",
      place: placeName,
      /** A place left vacant, its club having left the season before it was decided, beside the dashed open plaque. */
      vacant: "Nicht vergeben",
    },

    contact: {
      email: "E-Mail",
    },
  },

  notFound: "Seite nicht gefunden",

  /** One paragraph of a confirmation page, its sentences in reading order. */
  paragraph: (...sentences: Copy[]) => sentences.join(" "),

  /**
   * The areas under `/area` as a server page alone words them, beside `AREA_COPY`: the landing of a person no entry
   * admits to a page, a row's line, and the match report's pages where no form stands.
   */
  area: {
    /** Konto's callout for a signed-in person no entry admits to a page, by what stands in the way. */
    noRole: {
      none: "Du hast gerade keine Funktion.",
      /** A contact person or a referee whose own link is unanswered. */
      unconfirmed: "Dein Eintrag ist noch nicht bestätigt.",
      /** A pupil whose confirmed registration waits on the team. */
      notAdmitted: "Dein Team hat dich noch nicht aufgenommen.",
    },
    schiedsrichter: {
      /** Before the kick-off, named by its day and time as the match's row names them (`COPY.spielplan.when`). */
      spielberichtFrom: (when: Copy) => `Spielbericht ab ${when}`,
      /** A fixture another referee is booked onto, or one a club's exit took the booking off, on the list's chip too. */
      unbooked: "Nicht mehr eingeteilt",
      /** A finished season's fixture whose report was never written, which its form takes no more of. */
      unreported: "Kein Spielbericht eingetragen",
    },
  },

  /** One word for where a season stands: before its start, running, or over once its places are decided. */
  saisonState: { planned: "Geplant", running: "Läuft", decided: "Vorbei" },

  /** The public season pages and the kit's season blocks, drawn on the server alone. */
  season: {
    gruppe: gruppeName,
    thirdPlace: "Spiel um Platz 3",
    labelled: (label: Words, when: Words) => lineOf([textOf(label), textOf(when)]),
    /**
     * Where a club stands, under its name in a match head, linking to its row on the Tabelle; a club that has
     * played no match holds no place yet, and the line names its group alone.
     */
    standing: (platz: number | null, gruppe: string) => lineOf([platz === null ? null : placeName(platz), gruppeName(gruppe)]),

    /** The Tabelle's and the club page's column heads: the short forms on every width. */
    column: {
      platz: PLATZ,
      team: TEAM,
      spiele: SPIELE_SHORT,
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
      position: COPY.kader.position,
    },

    /**
     * The ⓘ after each group's title on the Tabelle, naming the marks its rows draw by the entries that draw them. The
     * green edge marks a place the club holds alone within the qualifier count as the table stands now, so it says
     * „derzeit“, and the grey edge of a shared place is no qualifier.
     */
    tabelle: {
      /** A key to the standing's marks, one short line each, as the owner asked: each mark, then what it says. */
      help: [
        `${COPY.shared.season.cancelledMark(1)} bei ${SPIELE_SHORT}: ${COPY.shared.season.cancelled(1)}`,
        // Each meaning is the entry the mark's own words come from, so a rewording reaches the key too.
        `${COPY.shared.austritt.disqualifikation.shorthand}: ${COPY.shared.austritt.disqualifikation.state}`,
        `${COPY.shared.austritt.rueckzug.shorthand}: ${COPY.shared.austritt.rueckzug.state}`,
        `Grüner Rand: ${COPY.shared.season.qualifies.settled}`,
        `Grauer Rand: ${COPY.shared.season.qualifies.level}`,
      ],
    },

    /** Teams' group filter, and „Alle“ (all), the choice a filter opens on where no entry of its own names a narrower one. */
    filter: { gruppe: COPY.team.gruppe, all: "Alle" },

    team: {
      platz: PLATZ,
      punkte: "Punkte",
      spiele: COPY.page.spiele,
      tore: COPY.shared.tore,
      differenz: (difference: number) => `${DIFFERENZ} ${formatSigned(difference)}`,
    },

    spiel: {
      aufstellung: "Aufstellung",
      toreAndCards: "Tore und Karten",
      /**
       * The plural the match's empty timeline names until its report is adopted, whose goals and cards are not
       * official before: „Noch keine offiziellen Tore und Karten.“, where an adopted report naming none reads
       * „Noch keine Tore und Karten.“
       */
      officialToreAndCards: "offiziellen Tore und Karten",
      tor: COPY.spielplan.goal,
      eigentor: "Eigentor",
      card: { gelb: "Gelbe Karte", gelb_rot: "Gelb-Rote Karte", rot: "Rote Karte" } satisfies Record<FLCardColour, string>,
      event: (what: Copy, who: Words) => lineOf([what, textOf(who)]),
      /**
       * A dated match holding no hour, which takes no line-up until its kick-off is set, as both line-up pages title it:
       * its day as the match's row names it (`COPY.spielplan.when`), and that the hour is still to settle, as „Termin
       * offen“ says of a date.
       */
      timeOpen: (day: Copy) => lineOf([day, "Uhrzeit offen"]),
    },
  },

  /**
   * The two legal pages' text, which their pages set as the kit's `Prose` blocks under their titles; the copy
   * standard's legal section governs it. Every bound the code holds, the frontend's or one the backend publishes, is a
   * parameter, so the text states the one the code keeps; a period a provider or the host holds is written out. A
   * paragraph with a link is a function of the link, returning its runs in reading order.
   */
  legal: {
    privacyNotice: {
      firstLayer: {
        heading: "Das Wichtigste",
        items: [
          `Verantwortlich ist der ${VEREIN_NAME}, ${VEREIN_ADDRESS}.`,
          "Wir verarbeiten, was du uns für eine Bewerbung, einen Kader, ein Spiel oder deine Anmeldung angibst, und die technischen Daten jedes Aufrufs.",
          "Wir brauchen diese Daten, um den Spielbetrieb der Liga durchzuführen, dich zu erreichen und die Website sicher zu betreiben.",
          "Öffentlich sind Teams, Spielpläne, Ergebnisse und Aufstellungen. Deinen Namen zeigen wir dort nur mit deiner Einwilligung.",
          "Wir messen nicht, was du auf der Website tust, und verkaufen keine Daten.",
          "Du kannst Auskunft über deine Daten verlangen, ihre Berichtigung, Löschung oder Einschränkung und ihre Herausgabe. Du kannst widersprechen und jede Einwilligung widerrufen. Und du kannst dich bei der Aufsichtsbehörde beschweren.",
        ],
        contact: (mail: TextLink<Words>) => ["Dafür genügt eine formlose E-Mail an ", mail, "."] as const,
      },
      basis: {
        heading: "Rechtsgrundlagen",
        text: "Wo nichts anderes steht, verarbeiten wir deine Daten auf Grundlage von Art.\u00A06 Abs.\u00A01 lit.\u00A0f DSGVO. Unser berechtigtes Interesse ist, den Spielbetrieb der Liga durchzuführen, dich zu erreichen, Fehler in den Daten zu erkennen und die Website vor Angriffen und Missbrauch zu schützen. Wo du eine Einwilligung gibst, ist sie die Grundlage (Art.\u00A06 Abs.\u00A01 lit.\u00A0a DSGVO). Die Namen des Vorstands im Impressum nennen wir, weil das Gesetz es verlangt (§\u00A05 DDG, Art.\u00A06 Abs.\u00A01 lit.\u00A0c DSGVO).",
      },
      website: {
        heading: "Website und Browser",
        requests:
          "Jede Anfrage an die Website läuft zuerst über Cloudflare, Inc. Cloudflare sieht dabei deine IP-Adresse, die aufgerufene Adresse, die Angaben deines Browsers und jedes Formular, das du abschickst. Bei jedem Aufruf speichert unser Server deine IP-Adresse, den Zeitpunkt, die aufgerufene Seite, den Statuscode und die Kennung deines Browsers.",
        // One sentence per thing the browser holds. The passkey cookie's 5 minutes are Better Auth's own, which the library
        // sets and exports no name for. The code's cookie lives as long as the code it was asked for. The mailed link's
        // hour is typed as its one figure, the singular „Stunde“ being the sentence's.
        browser: (codeMinutes: number, mailedLinkHours: 1) =>
          `In deinem Browser legt die Website nur ab, was ihr Betrieb braucht. Meldest du dich an, legt sie ein Sitzungs-Cookie ab. Für die Anmeldung mit einem Passkey legt sie ein Cookie ab, das 5\u00A0Minuten gilt. Forderst du einen Code zur Anmeldung an, legt sie ein Cookie ab, das den Code an diesen Browser bindet; es gilt ${boundBy(formatNumber(codeMinutes), "Minuten")}. Öffnest du einen Link aus einer E-Mail oder den Registrierungslink deines Teams, hält ein Cookie ihn ${boundBy(formatNumber(mailedLinkHours), "Stunde")} lang, bis du ihn benutzt. Im lokalen Speicher legt sie die Darstellung ab, die du wählst.`,
        turnstile:
          "Auf der Anmeldeseite, im Bewerbungsformular und im Registrierungsformular prüft Cloudflare Turnstile, ob ein Mensch das Formular abschickt. Dafür fragt Turnstile Merkmale deines Browsers und deiner Verbindung ab. Cloudflare nutzt sie auch in eigener Verantwortung, um seine Erkennung automatisierter Zugriffe zu verbessern. Was die Website in deinem Browser ablegt und was Turnstile abfragt, ist nach §\u00A025 Abs.\u00A02 Nr.\u00A02 TDDDG ohne Einwilligung zulässig.",
      },
      bewerbung: {
        heading: "Bewerbung einer Schule",
        form: "Das Bewerbungsformular fragt Angaben zur Schule und zu ihrem Team ab, darunter die Anschrift der Schule. Für jede Rolle fragt es Name, E-Mail-Adresse und Telefonnummer einer Person ab. Die Rollen sind Trainerin oder Trainer, Ansprechperson und Stellvertretung. Eine Person kann zwei Rollen haben. Freiwillig sind nur die Website der Schule, der Trikotsatz und der Wunschgegner. Die Angaben zu den Kontaktpersonen erhalten wir von der Person, die die Bewerbung einreicht.",
        confirmation: (days: number, trainerAge: number, otherAge: number) =>
          `Jede Kontaktperson bestätigt ihren Eintrag innerhalb von ${boundBy(formatNumber(days), "Tagen")} über einen eigenen Link mit ihrem Geburtsdatum, oder sie widerspricht ihm. Das gilt auch, wenn die Liga sie selbst einträgt. Liegen an einer E-Mail-Adresse schon mehrere offene Links der Saison, bekommt sie keinen weiteren, außer die Liga sendet ihn. Das Mindestalter ist ${boundBy(formatNumber(otherAge), "Jahre")}. Für eine Trainerin oder einen Trainer ohne zweite Rolle ist es ${boundBy(formatNumber(trainerAge), "Jahre")}.`,
        // An objection's mail names the seat it emptied, never its holder.
        visibility:
          "Sobald wir die Ansprechperson angeschrieben haben, erfährt sie die Rollen der anderen Kontaktpersonen. Widerspricht eine Kontaktperson, erfährt die Ansprechperson ihre Rolle, nicht ihren Namen. Die Kontaktpersonen eines Teams sehen in dessen Übersicht die Namen und Rollen der anderen und wer bestätigt hat. E-Mail-Adresse, Telefonnummer und Geburtsdatum der anderen sehen sie nicht.",
        outcome:
          "Widerspricht eine Kontaktperson, entfernen wir ihre Angaben aus der Bewerbung. Bestätigt eine Kontaktperson nicht rechtzeitig, löschen wir die Bewerbung und schreiben das allen, die ihren Eintrag bestätigt haben. Hat die Liga sie direkt bei einem Team eingetragen, löschen wir nur ihren Eintrag.",
      },
      kader: {
        heading: "Im Kader",
        text: (minAge: number, days: number) =>
          `Für den Kader eines Teams registrierst du dich über dessen Link mit Name und E-Mail-Adresse. Wenn du willst, gibst du auch Trikotnummer, Position und Stufe an. Innerhalb von ${boundBy(formatNumber(days), "Tagen")} bestätigst du über einen Link mit deinem Geburtsdatum, dass du mindestens ${boundBy(formatNumber(minAge), "Jahre")} alt bist. Über die Aufnahme entscheiden die Kontaktpersonen des Teams. Deine E-Mail-Adresse, dein Geburtsdatum und deine Antworten sehen sie nicht. Wer ein Spiel deines Teams pfeift, sieht für den Spielbericht beide Kader mit Vor- und Nachnamen und Trikotnummer.`,
      },
      schiedsrichter: {
        heading: "Schiedsrichterinnen und Schiedsrichter",
        text: (days: number, minAge: number) =>
          `Pfeifst du für die Liga, trägt sie dich mit Name, Kontaktdaten, Schule und Honorar ein. Diese Angaben haben wir von dir oder von der Person, die dich genannt hat. Über einen Link bestätigst du den Eintrag innerhalb von ${boundBy(formatNumber(days), "Tagen")} mit deinem Geburtsdatum. Pfeifen kann, wer mindestens ${boundBy(formatNumber(minAge), "Jahre")} alt ist. ${OBJECTION_DELETES_ENTRY} Löschen wir deinen Eintrag, steht an deinen gespielten Spielen „anonym“ mit dem Honorar, und aus angesetzten Spielen nehmen wir dich heraus.`,
      },
      spiele: {
        heading: "Spiele und Spielberichte",
        // The decline's box is labelled „Grund“, and the administration's entry of an answer requires one.
        text: "Vor einem Spiel fragen wir beide Teams und die Schiedsrichterin oder den Schiedsrichter, ob der Termin steht. Wer einen Termin ablehnt, kann einen Grund als freien Text angeben. Trägt die Verwaltung eine Antwort ein, schreibt sie dazu, wie sie zustande kam. Nach dem Spiel trägt die Schiedsrichterin oder der Schiedsrichter einen Spielbericht ein: Ergebnis, Tore und Karten mit Minute und Person sowie Bemerkungen als freien Text.",
      },
      /** A person's sign-in and account; what holds only with access to the administration is `administration`'s. */
      account: {
        heading: "Anmeldung und Konto",
        signIn: (codeMinutes: number) =>
          `Du meldest dich mit einem Code an, den wir dir schicken. Den Code löschen wir nach ${boundBy(formatNumber(codeMinutes), "Minuten")}.`,
        sessions: (idleDays: number, days: number, sessionDays: number) =>
          `Eine Sitzung endet nach ${boundBy(formatNumber(idleDays), "Tagen")} ohne Nutzung, spätestens nach ${boundBy(formatNumber(days), "Tagen")}. Wir löschen eine Sitzung ${boundBy(formatNumber(sessionDays), "Tage")} nach ihrer letzten Nutzung.`,
        changes: (linkHours: number, stopDays: number) =>
          `Eine neue E-Mail-Adresse bestätigst du zuerst über einen Link an deine bisherige Adresse, danach über einen Link an die neue. Jeder Link gilt ${boundBy(formatNumber(linkHours), "Stunden")}. Die neue Adresse gilt, sobald du beide bestätigt hast. Kommst du an deine bisherige Adresse nicht mehr heran, ändert die Liga sie auf deine Anfrage. Die bisherige Adresse erfährt davon und kann die Änderung ${boundBy(formatNumber(stopDays), "Tage")} lang stoppen.`,
        erasure:
          "Dein Konto löschst du selbst. Das bestätigst du über einen Link an deine Adresse. Sonst bleibt dein Konto, solange unter deiner Adresse ein Eintrag bei uns besteht.",
        ban: "Stört eine Adresse den Spielbetrieb, kann die Verwaltung sie sperren. Mit ihr meldet sich dann niemand an, und sie bekommt keine E-Mails. Hat sie ein Konto, schreiben wir das dorthin.",
      },
      /** What holds only with access to the administration, the passkey among it: no other account holds one. */
      administration: {
        heading: "Zugang zur Verwaltung",
        // An administrator's idle hour is typed as its one figure: a sentence reading „nach 1 Stunde“ is singular.
        signIn: (idleHours: 1, hours: number) =>
          `Mit Zugang zur Verwaltung meldest du dich nur mit einem Passkey an. Eine Sitzung für die Verwaltung endet schon nach ${boundBy(formatNumber(idleHours), "Stunde")} ohne Nutzung, spätestens nach ${boundBy(formatNumber(hours), "Stunden")}.`,
        passkey: {
          lead: "Zu einem Passkey speichern wir:",
          items: [
            "seinen öffentlichen Schlüssel mit Kennung und Zähler,",
            "den Anbieter, bei dem er liegt,",
            "ob er gesichert werden kann und ob er es ist,",
            "wie dein Gerät ihn erreicht,",
            "wann er eingerichtet wurde,",
            "seinen Namen.",
          ],
          never: "Seinen privaten Schlüssel speichern wir nie.",
        },
        address: (administratorWait: Wait, ownerWait: Wait) =>
          `Änderst du mit Zugang zur Verwaltung deine Adresse, gilt die neue erst ${waitWords(administratorWait).span}, nachdem du beide bestätigt hast. Für die ${ownerTier} und für die Person, an die sie gerade übergeben wird, gilt sie erst ${waitWords(ownerWait).after}. Bis dahin gilt die bisherige Adresse.`,
        grants: (administratorWait: Wait, ownerWait: Wait) =>
          `Ein neuer Zugang gilt erst ${waitWords(administratorWait).after}. Die Übergabe der ${ownerTier} gilt erst ${waitWords(ownerWait).after}. Von jedem dieser Schritte erfahren alle mit Zugang und die genannte Person sofort.`,
        undo: `Bis dahin kann die ${ownerTier} jeden dieser Schritte zurückziehen. Eine neue Adresse kannst auch du selbst zurückziehen, im Konto oder über den Link an deine bisherige Adresse.`,
        erasure: `Mit der ${ownerTier} kannst du dein Konto erst nach ihrer Übergabe löschen, weil die Liga immer eine ${ownerTier} braucht. Deine Rechte unter „Deine Rechte“ bleiben davon unberührt.`,
      },
      mail: {
        heading: "E-Mail und WhatsApp",
        senders: (signIn: string, league: string) =>
          `Unsere E-Mails verschicken wir über Resend. Codes und Sicherheitshinweise kommen von ${signIn}, alle anderen von ${league}. Resend meldet uns, ob eine E-Mail ankommt. Das speichern wir bei der Nachricht.`,
        forwarding:
          "E-Mails an die Liga kommen in ihr Postfach bei Google Workspace. Ein Mitglied des Vorstands liest dieses Postfach. Das Postfach leitet jede Nachricht an ein Mitglied des Vereins weiter. Im Postfach der Liga löschen wir jede Nachricht 6\u00A0Monate nach ihrem Eingang.",
        whatsapp:
          "Über WhatsApp schreiben wir dir nur, wenn du das erlaubt hast oder uns dort schreibst. Dann erhält WhatsApp deine Telefonnummer und die Nachrichten.",
      },
      published: {
        heading: "Was wir veröffentlichen",
        record:
          "Auf der Website stehen Name, Kürzel, Schule und Anschrift jedes Teams. Dazu kommen Spielpläne, Ergebnisse und Tabellen. Aufstellungen stehen dort, sobald ein Team sie einträgt, Tore und Karten, sobald der Spielbericht feststeht. Als freier Text stehen dort Notizen zu Spielen, Beschreibungen von Teams und der Grund für einen Rückzug.",
        names:
          "Stehst du im Kader, zeigen wir deinen Vornamen und den Anfangsbuchstaben deines Nachnamens: im Kader, in Aufstellungen und bei Toren und Karten. Pfeifst du, zeigen wir an deinen Spielen den ersten Teil deines Namens und den Anfangsbuchstaben des nächsten. Hast du nur einen Namen, zeigen wir ihn ganz. Beides zeigen wir nur mit deiner Einwilligung, sonst steht dort nur „anonym“. Trikotnummer und Position zeigen wir nur neben deinem Namen. Hast du im Kader die Rolle „Kapitän“ oder „Co-Kapitän“, zeigen wir sie dort und in Aufstellungen neben deinem Namen, nie neben „anonym“.",
        // The names stand in the public source code too, whose earlier versions keep a removed one.
        organisers: `Ebenfalls nur mit Einwilligung zeigen wir die Vornamen der Personen, die die Liga organisieren. Sie stehen auf der Startseite, unter „${COPY.page.about}“ und im öffentlichen Quellcode der Website. Widerruft jemand von ihnen, entfernen wir den Namen von der Website und aus dem aktuellen Quellcode. Frühere Versionen des Quellcodes behalten ihn.`,
        media: (mediaAge: number) =>
          `Ab ${boundBy(formatNumber(mediaAge), "Jahren")} zeigen wir, ebenfalls nur mit deiner Einwilligung, Fotos, Videos und Interviews, auf denen du zu erkennen bist, hier und auf dem Instagram-Kanal der Liga. Widerrufst du, entfernen wir Fotos, Videos und Interviews von dir von der Website und vom Instagram-Kanal der Liga.`,
        // The Stufe is a squad row's; no referee record holds one.
        never:
          "Nie veröffentlichen wir Kontaktdaten, Geburtsdaten, Registrierungen, Kontaktpersonen, Antworten zu Einwilligungen, die Stufe im Kader, Schule und Honorar einer Schiedsrichterin oder eines Schiedsrichters und die Bemerkungen eines Spielberichts.",
      },
      recipients: {
        heading: "Empfänger",
        lead: "Außer uns und den oben genannten Personen erhalten deine Daten nur:",
        items: [
          "Hetzner Online GmbH, Nürnberg: unser Server;",
          "Cloudflare, Inc.: jede Anfrage und Turnstile;",
          "MongoDB, Inc.: die Datenbank und ihre Sicherungskopien, in Frankfurt am Main;",
          "Resend (Plus Five Five, Inc.): unsere E-Mails;",
          "Google Cloud EMEA Limited, Dublin (Google Workspace for Nonprofits): E-Mails an die Liga;",
          "die Anbieter der privaten Postfächer: Mitteilungen zum Zugang zur Verwaltung und, wo ein Mitglied des Vereins sie dort liest, E-Mails an die Liga, ohne Vertrag zur Auftragsverarbeitung;",
          "WhatsApp Ireland Limited, wenn du WhatsApp erlaubst: die gewöhnliche App, ohne Vertrag zur Auftragsverarbeitung;",
          "Meta (Instagram), selbst verantwortlich: die Fotos, Videos und Interviews, die du erlaubst.",
        ],
        transfers:
          "Daten, die in die Vereinigten Staaten gehen, übermitteln wir auf Grundlage des Angemessenheitsbeschlusses zum EU-US Data Privacy Framework (Art.\u00A045 DSGVO). Für Cloudflare gelten zusätzlich die Standardvertragsklauseln der Europäischen Kommission (Art.\u00A046 Abs.\u00A02 lit.\u00A0c DSGVO). Für Resend gelten sie ebenso. Google übermittelt in andere Länder ohne Angemessenheitsbeschluss auf Grundlage dieser Klauseln. Eine Kopie der Klauseln schicken wir dir auf Anfrage. Ein privates Postfach kann in einem Land ohne Angemessenheitsbeschluss liegen. Für diese Übermittlung gibt es keine geeigneten Garantien. Darüber hinaus geben wir keine Daten weiter, auch nicht an unsere Sponsoren.",
      },
      /**
       * The retention table: each store's name, what it holds and how long. A bound the code holds is a parameter; a
       * period a host script or a provider holds is written out. A declined item's days are `declinedDays`; where one
       * figure stands for an unconfirmed and a declined item, the confirmation link's days stand for both, the
       * backend's one `CONFIRMATION_DEADLINE_DAYS`.
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
              `${boundBy(formatNumber(bound.bewerbungDays), "Tage")}, wenn nicht alle bestätigen; abgelehnt ${boundBy(formatNumber(bound.declinedDays), "Tage")}; sonst bis zum Ende der Saison danach`,
          },
          {
            name: "Kontaktpersonen",
            content: "Kontaktdaten, Geburtsdatum, Antworten",
            period: (bound: RetentionBounds) =>
              `${boundBy(formatNumber(bound.bewerbungDays), "Tage")}, wenn unbestätigt oder abgelehnt; sonst bis zum Ende der Saison danach`,
          },
          {
            name: "Registrierung",
            content: "Name, Adresse, Geburtsdatum, Trikotnummer, Position, Stufe, Antworten",
            period: (bound: RetentionBounds) =>
              `${boundBy(formatNumber(bound.registrierungDays), "Tage")}, wenn unbestätigt oder abgelehnt; sonst bis zur Aufnahme, längstens bis zum Ende der Saison`,
          },
          {
            name: "Registrierungslinks",
            content: "Team, Saison",
            period: "ohne Frist",
          },
          // A returning pupil's earlier squad rows stand until the season after their last.
          {
            name: "Kader und Aufstellungen",
            content: "Name, Adresse, Geburtsdatum, Trikotnummer, Position, Stufe, Rolle, Antworten",
            period: "bis zum Ende der Saison nach deiner letzten im Kader",
          },
          {
            name: "Schiedsrichter",
            content: "Name, Kontaktdaten, Geburtsdatum, Schule, Honorar, Antworten",
            period: (bound: RetentionBounds) =>
              `${boundBy(formatNumber(bound.schiedsrichterDays), "Tage")} ab dem letzten Link, wenn unbestätigt; sonst bis du oder die Liga den Eintrag beendet`,
          },
          {
            name: "Teams und Spiele",
            content: "Ergebnisse, Tore, Karten, Notizen",
            period: "als Chronik der Liga; Namen darin nur, solange der Eintrag der Person besteht",
          },
          {
            name: "Freie Texte zu Spielen",
            content: "Gründe beim Ablehnen eines Termins und beim Eintragen einer Antwort, Bemerkungen",
            period: "bis zum Ende der Saison danach",
          },
          {
            name: "Gesperrte Adresse",
            content: "Adresse, Grund, Datum",
            period: (bound: RetentionBounds) => `bis zum Ende der ${boundBy(formatOrdinal(bound.banSaisons), "Saison")} danach`,
          },
          // The tier by the words its chips show.
          {
            name: "Zugang zur Verwaltung",
            content: `Adresse, ${ownerTier} oder Verwaltung, Beginn, Passkeys`,
            period: "bis er endet",
          },
          { name: "Konto", content: "Adresse", period: "solange ein Eintrag besteht" },
          // The sign-in stores the plain address of anyone typed into the form, up to the mail cap.
          {
            name: "Anmeldung",
            content: "Adresse, Code; Zahl der Codes und der Fehlversuche je Adresse, pseudonymisiert",
            period: (bound: RetentionBounds) =>
              `Code ${boundBy(formatNumber(bound.code.minutes), "Minuten")}; Codes ${boundBy(formatNumber(bound.code.mailHours), "Stunde")}, Fehlversuche ${boundBy(formatNumber(bound.code.failureHours), "Stunden")}`,
          },
          {
            name: "Sitzungen",
            content: "Beginn, letzte Nutzung, Art der Anmeldung",
            period: (bound: RetentionBounds) => `${boundBy(formatNumber(bound.sessionDays), "Tage")} nach der letzten Nutzung`,
          },
          {
            name: "Adressänderung",
            content: "Beide Adressen",
            period: (bound: RetentionBounds) =>
              `jeder Link ${boundBy(formatNumber(bound.addressChangeLinkHours), "Stunden")}; Adressen bis zu ihrem Ende, der Rest ${boundBy(formatNumber(bound.addressChangeRetentionDays), "Tage")} danach`,
          },
          {
            name: "Protokoll der Liga",
            content: "Wer was wann geändert hat, ohne Inhalte; beim Zugang die Adresse",
            period: (bound: RetentionBounds) => boundBy(monthsOf(bound.actionLogYears), "Monate"),
          },
          // The erasure journal is written as the server's own journald lines, kept nine days.
          {
            name: "Protokolle des Servers",
            content:
              "Aufrufe, Anmeldungen; Löschungen, Widerrufe und Widersprüche mit der Nummer des Eintrags, bei Kontaktpersonen auch dem Tag der Bestätigung",
            period: "9\u00A0Tage",
          },
          {
            name: "Unsere E-Mails",
            content: "Inhalt, Adresse, was Resend zur Zustellung meldet",
            period: (bound: RetentionBounds) =>
              `Inhalt bis zum Versand, der Rest ${boundBy(formatNumber(bound.outboxRetentionDays), "Tage")} danach`,
          },
          {
            name: "E-Mails bei Resend",
            content: "Adresse, Betreff, Inhalt",
            period: "30\u00A0Tage, in Sicherungen bis 7\u00A0Tage länger",
          },
          {
            name: "E-Mails an die Liga",
            content: "Absender, Inhalt, Anhänge",
            period: "6\u00A0Monate; danach bei Google bis 55\u00A0Tage wiederherstellbar, dann binnen 180\u00A0Tagen gelöscht",
          },
          { name: "Turnstile bei Cloudflare", content: "Signale deines Browsers beim Absenden eines Formulars", period: "7\u00A0Tage" },
        ],
      },
      erasure: {
        heading: "Löschung",
        text: "Löschen wir Daten, auf deinen Wunsch oder nach ihrer Frist, verschwinden sie sofort aus der Datenbank. Aus den Sicherungskopien verschwinden sie nach etwa 8\u00A0Tagen. Spielen wir eine ältere Sicherung ein, löschen wir sie erneut.",
        remainsLead: "Es bleiben:",
        /**
         * What outlives a deletion, one item each. The last is a deletion by a period's: no sweep deletes the address's
         * mail rows, which the address may still be owed under another role, so they keep the row „Unsere E-Mails“'s period.
         */
        remains: (deliveryDays: number, anchorHours: 1, outboxDays: number) => [
          "die Kopien bei Resend, bis zu ihren Fristen;",
          "von deinen E-Mails an uns die Kopien bei Google, bis zu ihren Fristen;",
          "von deinen E-Mails an uns die Kopien im Postfach des Mitglieds des Vereins, an das wir sie weiterleiten, bis wir sie dort auf deine Anfrage löschen;",
          "die Protokolle des Servers mit der Nummer eines Eintrags und, bei Kontaktpersonen, dem Tag der Bestätigung, bis zu ihrer Frist;",
          "nach der Zusage zu einer Bewerbung oder nach deinem Widerspruch der Link aus deiner E-Mail und der Tag deiner Antwort, ohne Namen und Adresse, längstens bis zum Ende der Saison danach;",
          "eine Sperre deiner Adresse, bis sie endet;",
          "die E-Mail mit dem Link zur Löschung, bis der Link abläuft;",
          `unsere Nachricht über die Löschung, höchstens ${boundBy(formatNumber(deliveryDays), "Tage")};`,
          `deine Adresse, pseudonymisiert, ${boundBy(formatNumber(anchorHours), "Stunde")} lang;`,
          "Mitteilungen zum Zugang zur Verwaltung, die andere schon erhalten haben;",
          "freie Texte, die nicht unter deiner Adresse stehen;",
          `nach einer Löschung nach ihrer Frist unsere E-Mails an deine Adresse: ihr Inhalt bis zum Versand, der Rest ${boundBy(formatNumber(outboxDays), "Tage")} danach;`,
          `nach einer Änderung deiner Adresse eine noch offene E-Mail zu deinem Passkey an die alte Adresse, bis ${boundBy(formatNumber(outboxDays), "Tage")} nach ihrem Versand oder dem letzten Versuch.`,
        ],
        // One's own deletion is confirmed on the page that made it, so no notice follows it.
        notices:
          "Löschen wir ein bestätigtes Konto, schreiben wir dir das, außer du hast es selbst gelöscht. Wir schreiben dir auch, wenn wir eine Bewerbung löschen, die nicht zustande kam und in der du deinen Eintrag bestätigt hast. An eine gesperrte Adresse schreiben wir in beiden Fällen nicht. Eine Absage nennt die Löschung schon selbst.",
        log: (logYears: number) =>
          `Was die Verwaltung an den Daten der Liga ändert, halten wir ${boundBy(monthsOf(logYears), "Monate")} im Protokoll der Liga fest. Ebenso halten wir fest, was Kontaktpersonen und Schiedsrichter für andere ändern, und die Löschung von Einträgen. Ein Eintrag sagt, wer es war, was geschah und wann, ohne alten oder neuen Inhalt. Beim Zugang zur Verwaltung steht darin die Adresse der genannten Person, auch wenn der Zugang nie galt. Die Verwaltung steht darin mit ihrer Adresse, alle anderen ohne Namen und Adresse. Zu einer Löschung stehen dort, wer sie veranlasst hat, und ein Verweis auf die Anfrage. Löschen wir deine Daten, ersetzt ein fester Vermerk deine Adresse.`,
      },
      rights: {
        heading: "Deine Rechte",
        text: (mail: TextLink<Words>) =>
          [
            "Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit (Art.\u00A015 bis 18 und 20 DSGVO). Eine Einwilligung widerrufst du jederzeit für die Zukunft, in deinem Konto oder per E-Mail. Was bis dahin geschah, bleibt rechtmäßig. Für alles genügt eine formlose E-Mail an ",
            mail,
            ".",
          ] as const,
        /** The Art. 21 DSGVO objection, set apart as Art. 21 (4) asks; a callout's text holds no link, so it names the address. */
        objection: {
          title: "Recht auf Widerspruch",
          text: `Jeder Verarbeitung auf Grundlage von Art.\u00A06 Abs.\u00A01 lit.\u00A0f DSGVO kannst du aus Gründen deiner besonderen Situation widersprechen (Art.\u00A021 DSGVO); eine E-Mail an ${KONTAKT_EMAIL} genügt.`,
        },
        closing:
          "Automatisierte Entscheidungen im Sinne von Art.\u00A022 DSGVO treffen wir nicht. Einen Datenschutzbeauftragten haben wir nicht bestellt. Beschweren kannst du dich bei einer Datenschutzaufsichtsbehörde, für uns beim Hessischen Beauftragten für Datenschutz und Informationsfreiheit, Postfach 3163, 65021 Wiesbaden.",
      },
      /** The notice's last paragraph: the day its words took effect. */
      asOf: (day: CalendarDay) => `Stand: ${formatDateLong(day)}`,
    },

    legalNotice: {
      provider: { heading: "Anbieter", name: VEREIN_NAME, address: VEREIN_ADDRESS },
      representation: {
        heading: "Vertretung",
        rule: `Je ${boundBy(formatNumber(VORSTAND_JOINTLY), "Mitglieder")} des Vorstands vertreten den Verein gemeinsam:`,
        member: (name: string, amt: string) => `${name}, ${amt}`,
      },
      /** Before the league's address, which the page sets as a link after it. */
      contact: { heading: "Kontakt", lead: "E-Mail: " },
      register: { heading: "Registereintrag", entry: VEREINSREGISTER },
      /** Before the repository's link, which the page sets after it under `link`. */
      licence: { heading: "Lizenz", lead: "Der Quellcode dieser Website steht unter der Elastic License 2.0: ", link: "Quellcode auf GitHub" },
    },
  },

  bewerbung: {
    end: {
      /** The landing's band alike, so the two pages say one thing of an upcoming window. */
      opensOn: (day: CalendarDay) => `Das Bewerbungsfenster öffnet am ${formatDateLong(day)}`,
      /** A paused window alike, the visitor being able to do nothing about either, and the landing's band, as `opensOn`. */
      closed: "Das Bewerbungsfenster ist gerade geschlossen",
      over: "Die Saison ist vorbei",
      none: "Keine Bewerbung für diese Saison",
      /** The outcome replacing the form, a replayed press alike. */
      submitted: "Jede Kontaktperson bestätigt per E-Mail",
    },
  },

  /**
   * The registration form's page, `ROUTES.registrierung`, beside the form's own words (`PUBLIC_COPY.registrierung`):
   * what a pupil reads before typing, and a status card's title for each state where no form stands.
   */
  registrierung: {
    /** Shown to a nominee alone, whose squad entry stands outside the squad's cap. */
    nominee: "Du wirst nachnominiert und spielst nur, wenn deinem Team sonst jemand fehlt.",
    /**
     * The Art. 21 DSGVO objection, read before anything is typed, in the one wording the first-contact mail closes on,
     * around the league's address, which the page sets as a link.
     */
    objection: (link: TextLink<string>) => objectionRight(link),
    end: {
      /** The outcome replacing the form, a replayed press alike: the title is what the pupil does next. */
      submitted: "Bestätige deine Registrierung per E-Mail",
      /** A paused link, as `bewerbung.end.closed` words a paused window; an ended season reads `bewerbung.end.over`. */
      closed: "Die Registrierung ist gerade geschlossen",
      kaderFull: "Der Kader ist voll",
      /** A team not in the season, or out of it. */
      teamNotEntered: "Das Team spielt nicht mit",
    },
  },

  /**
   * The fixed text of a contact person's confirmation page, `ROUTES.kontaktConfirmation`, titled
   * `COPY.page.entryConfirmation`: for whose application or team the person stands and as what, what is stored and until
   * when, what the birthdate is checked for, the deadline, what an objection does, and the privacy notice's link. The
   * Art. 21 objection with the league's address stands in the first-contact mail. The consents under it are
   * `CONSENT_WORDINGS`'; nobody accepts the notice, which informs and asks no consent.
   */
  kontaktConfirmation: {
    /** The person's own entry: the title of a closed row's page, which confirms nothing. */
    ownEntry: "Dein Eintrag",
    opening: {
      /**
       * A seat in an application, one text for all: it names no submitter, the form recording none, and no school, which
       * anyone sending the form types, as the application's mails name none.
       */
      named: (saison: string, seats: Words) =>
        `Du bist in der Bewerbung für die ${COPY.shared.saisonNameBound(saison)} als ${textOf(seats)} genannt.`,
      /** Seated by the league on a team's season, with no application. */
      seasonRow: (team: Words, saison: string, seats: Words) =>
        `Die Liga hat dich für ${textOf(team)} in der ${COPY.shared.saisonNameBound(saison)} als ${textOf(seats)} eingetragen.`,
    },
    stored: "Wir speichern deinen Namen, deine Kontaktdaten und dein Geburtsdatum längstens bis zum Ende der Saison danach.",
    /** The same on a closed row, whose seat no confirmation filled, so no birthdate stands on it. */
    closedStored: "Wir speichern deinen Namen und deine Kontaktdaten längstens bis zum Ende der Saison danach.",
    /** At the birthdate's field, by the seat's floor: Art. 13 asks the purpose where the date is asked. */
    ageCheck,
    /** The seat's own last day: an application goes whole when one of its seats lapses. A season row's is `entryConfirmation.deadline`. */
    applicationDeadline: (until: CalendarDay) => runsText(applicationDeadline(formatDateLong(until))),
    /** At the objection's control, read before the press, by the record the seat stands on. */
    objectionEffect: {
      application: "Widersprichst du, entfernen wir deine Angaben aus der Bewerbung.",
      seasonRow: OBJECTION_DELETES_ENTRY,
    },
    /** Why a closed row's page confirms nothing, a club out of the season; a past season's is `refusalLine.saison_past`. */
    teamDeparted: (team: Words) => `${textOf(team)} ist aus der Saison ausgeschieden.`,
    /** The last line, around the privacy notice's title, which the page sets as its link. */
    more,
  },

  /**
   * The two ends of an entry's answer, on a contact person's page and a referee's alike, each a title; a link opened
   * again after it titles it with the day (`COPY.shared.end.doneOn`).
   */
  entryConfirmation: {
    confirmed: "Eintrag bestätigt",
    objected: COPY.shared.state.objected,
    /**
     * The confirmed end's line where the press met a confirmation already standing: the choices this press carried are
     * dropped, and the person may believe them stored.
     */
    choicesKept: "Deine Auswahl von vorher gilt. Ändern kannst du sie im Konto.",
    /** The deadline of an entry that goes alone, a seat on a team's season and a referee's, the page's last paragraph. */
    deadline: (until: CalendarDay) => runsText(entryDeadline(formatDateLong(until))),
  },

  /**
   * The fixed text of a referee's confirmation page, `ROUTES.schiedsrichterConfirmation`, in the order of a contact's
   * and a pupil's: who named the person and for what, what is stored and until when, what an objection does and the
   * privacy notice's link, then the deadline (`entryConfirmation.deadline`). The age floor is the birthdate field's
   * bound, read off the link's view; the Art. 21 objection with the league's address stands in the first-contact mail.
   */
  schiedsrichterConfirmation: {
    opening: REFEREE_OPENING,
    stored: REFEREE_STORED,
    /** The deadline around its day: the mail sets the day semibold, the page writes it in the sentence's weight. */
    deadline: (day: string) => entryDeadline(day),
    /** What an objection does, the objection's question's sentence: it erases the entry at once, as a seat's empties the seat. */
    objectionEffect: OBJECTION_DELETES_ENTRY,
    /** The last words of the page's first paragraph, around the privacy notice's title, which the page sets as its link. */
    more,
  },

  /**
   * The fixed text of a pupil's confirmation page, `ROUTES.registrierungConfirmation`, built as `kontaktConfirmation`
   * is: the registration the pupil made, what is stored and until when, the deadline, what the birthdate is checked
   * for, the objection and the privacy notice's link.
   */
  registrierungConfirmation: {
    opening: (team: Words, saison: string) =>
      `Du hast dich über den Link von ${textOf(team)} für den Kader in der ${COPY.shared.saisonNameBound(saison)} registriert.`,
    // Admitted, the pupil's data stands on their squad rows, which the erasure sweep keeps until the season after the
    // last: the privacy notice's „Kader und Aufstellungen“ row in its own words.
    stored:
      "Wir speichern deinen Namen, deine E-Mail-Adresse, dein Geburtsdatum und, wenn du sie angegeben hast, Trikotnummer, Position und Stufe, längstens bis zum Ende der Saison nach deiner letzten im Kader.",
    ageCheck,
    deadline: (until: CalendarDay) => runsText(registrationDeadline(formatDateLong(until))),
    more,
    /** The done card's title; the link opened again titles it with the day (`COPY.shared.end.doneOn`). */
    confirmed: "Registrierung bestätigt",
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
    legalNotice: `Anbieterkennzeichnung der ${COPY.brand.name} nach §\u00A05 DDG.`,
    privacyNotice: `Welche Daten die ${COPY.brand.name} verarbeitet, auf welcher Grundlage und wie lange.`,
    sitemap: `Alle Seiten der ${COPY.brand.name} auf einen Blick.`,
  } satisfies Record<ListedRoute, string | ((...names: never) => string)>,
});
