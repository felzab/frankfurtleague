import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDateLong, formatDayAndTime, formatInstant, formatTime, timeOf } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Copy, Words } from "./copy";
import type { Fact, Mail, Paragraph, Sentence } from "./emailShell";
import type {
  FLAufstellungReminderData,
  FLAustrittNoticeData,
  FLSpielEinteilungData,
  FLSpielEinteilungLiftedData,
  FLSpielMailAnsetzung,
  FLSpielMailAppointment,
  FLSpielMovedData,
  FLSpielNoticeData,
  FLSpielRequestData,
  FLSpielVorschlagDiscardedData,
} from "./generated/client/types";
import type { MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.spiel;
const FACT = COPY.spielplan.fact;

const SCHIEDSRICHTER_PANEL_PATH = ROUTES.areaSchiedsrichter.path();

/** The fixture by its two sides in the fixture's own order, as the schedule lists them. */
const paarung = ({ team1, team2 }: Pick<FLSpielMailAppointment, "team1" | "team2">): Copy =>
  COPY.page.spiel({ record: team1 }, { record: team2 });

const moment = ({ date, time }: FLSpielMailAppointment): string => formatDayAndTime(dayOf(date), timeOf(time));

/** A sentence whose moment stands semibold between its two parts. */
const around = (before: Copy, value: string, after: Copy): Sentence => [before, { strong: value }, after];

/** The day and the hour, one fact to a row, so a reader scanning for the day finds it alone. */
const whenFacts = ({ date, time }: FLSpielMailAppointment): Fact[] => [
  { label: FACT.date, value: formatDateLong(dayOf(date)) },
  { label: FACT.time, value: formatTime(timeOf(time)) },
];

/**
 * A move's rows: the moment it left, and the one it moved to where it holds one. The block stands under the new
 * pairing, so where the move also changed the sides, the row of the slot left names the pairing it held. A change
 * keeping the day and the hour names them once, since a „Neu“ row repeating the moment left reads as a move.
 */
function moveFacts(from: FLSpielMailAppointment, to: FLSpielMailAppointment | null): Fact[] {
  if (to === null) return [{ label: WORDS.previous, value: moment(from) }];
  const sidesChanged = from.team1 !== to.team1 || from.team2 !== to.team2;
  if (from.date === to.date && from.time === to.time) {
    return [...whenFacts(to), ...(sidesChanged ? [{ label: WORDS.previous, value: paarung(from) }] : [])];
  }
  const previous = sidesChanged ? WORDS.previousPairing(paarung(from), moment(from)) : moment(from);
  return [
    { label: WORDS.previous, value: previous },
    { label: WORDS.next, value: moment(to) },
  ];
}

/** Whether a change kept the day and the hour and changed the sides: a new pairing at its slot, which nothing moved. */
const pairingOnly = (from: FLSpielMailAppointment, to: FLSpielMailAppointment): boolean =>
  from.date === to.date && from.time === to.time && (from.team1 !== to.team1 || from.team2 !== to.team2);

/** The fixture under its pairing, its ground last; after a move, the move's rows in the day's and the time's place. */
function slotBlock(ansetzung: FLSpielMailAnsetzung, movedFrom: FLSpielMailAppointment | null): NonNullable<Mail["block"]> {
  const when = movedFrom === null ? whenFacts(ansetzung) : moveFacts(movedFrom, ansetzung);

  // A ground nobody assigned, in words: a mail has no glyph for it.
  return { title: paarung(ansetzung), facts: [...when, { label: FACT.spielort, value: ansetzung.spielort ?? COPY.shared.notProvided }] };
}

/** The deadline and the first-answer rule: any seat of the club answers, so a reader told nothing takes a date already answered for one lost. */
const answerParagraph = (deadline: string): Paragraph => [
  around(WORDS.answerUntil.before, formatDateLong(dayOf(deadline)), WORDS.answerUntil.after),
  WORDS.firstAnswerCounts,
];

/**
 * A club's request to confirm a fixture, the reminder of it, or the request about the slot a move went to, which is then
 * the one mail telling the club of the move: to one mailbox of one of its teams. No token: the reader answers on the
 * team's own pages, signed in.
 */
export function buildSpielRequestEmail(
  { kind, team, team_id: teamId, saison_id: saison, ansetzung, deadline, moved_from: movedFrom }: FLSpielRequestData,
  { origin }: MailOrigin,
): Mail {
  const site = mailOrigin(origin);
  const day = dayOf(ansetzung.date);
  const ask = WORDS.confirmAsk({ record: team });
  // A reminder carries no move: the move's own request is the one mail telling of it. A new pairing at its slot is asked
  // as a request is, its block naming the pairing left.
  const [subjectLine, lead]: readonly [Copy, Paragraph] =
    movedFrom !== null && !pairingOnly(movedFrom, ansetzung)
      ? [WORDS.movedSubject(day), [WORDS.moved(paarung(ansetzung)), ask]]
      : kind === "spiel_reminder"
        ? [WORDS.reminderSubject(day), [WORDS.answerMissing({ record: team }), ask]]
        : [WORDS.requestSubject(day), [ask]];

  return {
    kind: "notice",
    subjectLine,
    origin: site,
    paragraphs: [lead],
    block: slotBlock(ansetzung, movedFrom),
    afterBlock: [answerParagraph(deadline)],
    button: { label: COPY.shared.end.toOverview, href: `${site}${ROUTES.teamOverview.path(teamId, saison)}` },
  };
}

/**
 * The referee's word that they are booked, or of the slot a move went to while they stay booked, which is then the one
 * mail telling them of the move. No token: the referee answers on their own panel, signed in.
 */
export function buildSpielEinteilungEmail({ ansetzung, moved_from: movedFrom }: FLSpielEinteilungData, { origin }: MailOrigin): Mail {
  const site = mailOrigin(origin);
  const spiel = paarung(ansetzung);
  // A new pairing at its slot books the referee as a first Einteilung does, its block naming the pairing left.
  const moved = movedFrom !== null && !pairingOnly(movedFrom, ansetzung);

  return {
    kind: "notice",
    subjectLine: moved ? WORDS.movedSubject(dayOf(ansetzung.date)) : WORDS.bookedSubject(dayOf(ansetzung.date)),
    origin: site,
    paragraphs: [[moved ? WORDS.moved(spiel) : WORDS.booked(spiel)]],
    block: slotBlock(ansetzung, movedFrom),
    afterBlock: [[WORDS.sayYesOrNo]],
    button: { label: COPY.shared.end.toOverview, href: `${site}${SCHIEDSRICHTER_PANEL_PATH}` },
  };
}

/** The word to a referee that they no longer referee a fixture they were told of: nothing is left for them to answer. */
function unbookedEmail(appointment: FLSpielMailAppointment, origin: string): Mail {
  return {
    kind: "notice",
    subjectLine: WORDS.unbookedSubject(dayOf(appointment.date)),
    origin: mailOrigin(origin),
    paragraphs: [[around(WORDS.unbooked.before(paarung(appointment)), moment(appointment), WORDS.unbooked.after)]],
  };
}

/** A notice naming a fixture, the reader's next mail, if any, being the request or the Einteilung it states. */
function noticeEmail(subjectLine: Copy, origin: string, paragraph: Paragraph, block?: Mail["block"]): Mail {
  return {
    kind: "notice",
    subjectLine,
    origin: mailOrigin(origin),
    paragraphs: [paragraph],
    ...(block ? { block } : {}),
  };
}

/**
 * The word that a fixture a party was asked about will not be played, by its event: the slot it was asked about, and
 * what the event means for the result as the match page's callout says it. No later mail is promised.
 */
function cancelledEmail({ appointment, sonderereignis }: FLSpielNoticeData, origin: string): Mail {
  const day = dayOf(appointment.date);
  const { cancelled } = WORDS;
  const { consequence } = COPY.spielplan.sonderereignis;
  const lead = (words: { before: (subject: Words) => Copy; after: Copy }, subject: Words): Sentence =>
    around(words.before(subject), moment(appointment), words.after);
  const spiel = paarung(appointment);

  switch (sonderereignis) {
    case "ausgefallen":
      return noticeEmail(cancelled.ausgefallen.subject(day), origin, [lead(cancelled.ausgefallen, spiel), consequence.notScored]);
    case "annulliert":
      return noticeEmail(cancelled.annulliert.subject(day), origin, [lead(cancelled.annulliert, spiel), consequence.notScored]);
    // The side that stayed away, then the one the match is counted for.
    case "nichtantreten_team1":
    case "nichtantreten_team2": {
      const [absent, opponent] =
        sonderereignis === "nichtantreten_team1" ? [appointment.team1, appointment.team2] : [appointment.team2, appointment.team1];
      return noticeEmail(cancelled.nichtantreten.subject(day), origin, [
        lead(cancelled.nichtantreten, { record: absent }),
        consequence.nichtantreten({ record: opponent }),
      ]);
    }
    // A row queued without an event names none, and a mail naming no event promises nothing it may not keep.
    case null:
      return noticeEmail(cancelled.none.subject(day), origin, [lead(cancelled.none, spiel)]);
  }
}

/**
 * The word that a fixture a party was asked about moved where no request about its new slot goes now, or will not be
 * played: the slot it was asked about, and on a move the slot it went to where it holds one, in the block a request
 * names it in, its ground among the rest. No button, nothing being left to answer here, and no later mail promised.
 */
export function buildSpielNoticeEmail(data: FLSpielMovedData | FLSpielNoticeData, { origin }: MailOrigin): Mail {
  if (data.kind === "spiel_cancelled") return cancelledEmail(data, origin);

  const { recipient, appointment, moved_to: movedTo, stays, asked_again: askedAgain } = data;

  // Taken off the fixture by the move: the void notice, naming the slot left alone. A notice queued before `stays` was
  // written said that the party stays by its promise of a request.
  if (movedTo === null && !stays && !askedAgain) {
    if (recipient === "schiedsrichter") return unbookedEmail(appointment, origin);
    return noticeEmail(WORDS.voidSubject(dayOf(appointment.date)), origin, [
      around(WORDS.void.before(paarung(appointment)), moment(appointment), WORDS.void.after),
    ]);
  }

  // Only a notice queued before the promise was dropped carries it.
  const lead: Paragraph = [WORDS.moved(paarung(movedTo ?? appointment)), ...(askedAgain ? [WORDS.askedLater[recipient]] : [])];

  if (movedTo === null) {
    return noticeEmail(WORDS.movedFromSubject(dayOf(appointment.date)), origin, lead, {
      title: paarung(appointment),
      facts: moveFacts(appointment, null),
    });
  }

  // A new pairing at the slot moved nothing: the slot stands, the block naming the pairing left. The lead says so of the
  // slot, since the new pairing never stood there. A notice queued with its promise keeps the mail it was queued for.
  if (pairingOnly(appointment, movedTo) && !askedAgain) {
    return noticeEmail(
      WORDS.keptSubject(dayOf(movedTo.date)),
      origin,
      [SERVER_COPY.overview.discardConsequence],
      slotBlock(movedTo, appointment),
    );
  }

  return noticeEmail(WORDS.movedSubject(dayOf(movedTo.date)), origin, lead, slotBlock(movedTo, appointment));
}

/** The word to a referee that their Einteilung is lifted, whoever took them off the fixture. */
export function buildSpielEinteilungLiftedEmail({ appointment }: FLSpielEinteilungLiftedData, { origin }: MailOrigin): Mail {
  return unbookedEmail(appointment, origin);
}

/**
 * The word to a club that the league kept the date it declined and proposed another for: its answer said the league
 * decides, and nothing else tells it the league has.
 */
export function buildSpielVorschlagDiscardedEmail({ appointment }: FLSpielVorschlagDiscardedData, { origin }: MailOrigin): Mail {
  return noticeEmail(WORDS.keptSubject(dayOf(appointment.date)), origin, [
    around(WORDS.kept.before(paarung(appointment)), moment(appointment), WORDS.kept.after),
    WORDS.keptDiscarded,
  ]);
}

/**
 * The one reminder to a club that a fixture's line-up is missing: the fixture between the two sentences, its day, its
 * hour and its ground as the fixture request names them, the second sentence naming the moment the backend counted it
 * due at. No token: the reader enters it on the team's own pages, signed in.
 */
export function buildAufstellungReminderEmail(
  { team, team_id: teamId, saison_id: saison, appointment, due_at: dueAt }: FLAufstellungReminderData,
  { origin }: MailOrigin,
): Mail {
  const site = mailOrigin(origin);
  const words = SERVER_COPY.mail.aufstellung;

  return {
    kind: "notice",
    subjectLine: words.reminderSubject(dayOf(appointment.date)),
    origin: site,
    paragraphs: [[words.missing({ record: team })]],
    block: slotBlock(appointment, null),
    afterBlock: [[around(words.dueUntil.before, formatInstant(dueAt), words.dueUntil.after)]],
    button: { label: COPY.shared.end.toOverview, href: `${site}${ROUTES.teamOverview.path(teamId, saison)}` },
  };
}

/**
 * The word to an opponent that a club left the season, listing the fixtures left open between them, an undated one by
 * what is still to settle. No button, as every notice, and no later mail promised: nothing mails a walkover.
 */
export function buildAustrittNoticeEmail({ team, saison_id: saison, spiele }: FLAustrittNoticeData, { origin }: MailOrigin): Mail {
  const words = SERVER_COPY.mail.austrittNotice;

  return noticeEmail(words.subject(team), origin, [[{ strong: team }, words.lead.after(saison)]], {
    title: COPY.page.spiele,
    facts: spiele.map((spiel) => ({
      label: words.when(dayOf(spiel.date), timeOf(spiel.time)),
      value: paarung(spiel),
    })),
  });
}
