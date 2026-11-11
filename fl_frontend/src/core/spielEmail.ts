import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDateLong, formatDayAndTime, formatInstant, formatTime, timeOf } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
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

/** The referee's own panel, the address `fl_frontend/src/features/roles/utils.ts` opens their Funktion on. */
const SCHIEDSRICHTER_PANEL_PATH = ROUTES.areaSchiedsrichter.path();

/** The fixture by its two sides in the fixture's own order, as the schedule lists them. */
const paarung = ({ team1, team2 }: Pick<FLSpielMailAppointment, "team1" | "team2">): Copy =>
  COPY.page.spiel({ record: team1 }, { record: team2 });

const moment = ({ date, time }: FLSpielMailAppointment): string => formatDayAndTime(dayOf(date), timeOf(time));

/** A sentence whose moment stands semibold between its two parts. */
const around = (before: Copy, value: string, after: Copy): Sentence => [before, { strong: value }, after];

/**
 * A move's rows: the moment it left, and the one it moved to where it holds one. The block stands under the new
 * pairing, so where the move also changed the sides, the row of the slot left names the pairing it held.
 */
function moveFacts(from: FLSpielMailAppointment, to: FLSpielMailAppointment | null): Fact[] {
  const sidesChanged = to !== null && (from.team1 !== to.team1 || from.team2 !== to.team2);
  const previous = sidesChanged ? WORDS.previousPairing(paarung(from), moment(from)) : moment(from);
  return [{ label: WORDS.previous, value: previous }, ...(to === null ? [] : [{ label: WORDS.next, value: moment(to) }])];
}

/**
 * The fixture under its pairing, one fact to a row, so a reader scanning for the day finds it alone; after a move, the
 * moment left and the one moved to in the day's and the time's place.
 */
function slotBlock(ansetzung: FLSpielMailAnsetzung, movedFrom: FLSpielMailAppointment | null): NonNullable<Mail["block"]> {
  const { date, time, spielort } = ansetzung;
  const when: Fact[] =
    movedFrom === null
      ? [
          { label: FACT.date, value: formatDateLong(dayOf(date)) },
          { label: FACT.time, value: formatTime(timeOf(time)) },
        ]
      : moveFacts(movedFrom, ansetzung);

  // A ground nobody assigned, in words: a mail has no glyph for it.
  return { title: paarung(ansetzung), facts: [...when, { label: FACT.spielort, value: spielort ?? COPY.shared.notProvided }] };
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
  // A reminder carries no move: the move's own request is the one mail telling of it.
  const [subjectLine, lead]: readonly [Copy, Paragraph] =
    movedFrom !== null
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

  return {
    kind: "notice",
    subjectLine: movedFrom === null ? WORDS.bookedSubject(dayOf(ansetzung.date)) : WORDS.movedSubject(dayOf(ansetzung.date)),
    origin: site,
    paragraphs: [[movedFrom === null ? WORDS.booked(spiel) : WORDS.moved(spiel)]],
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
 * The word that a fixture a party was asked about moved where no request about its new slot goes now, or was called off:
 * the slot it was asked about, and on a move the slot it went to where it holds one. No button, nothing being left to
 * answer here.
 */
export function buildSpielNoticeEmail(data: FLSpielMovedData | FLSpielNoticeData, { origin }: MailOrigin): Mail {
  const { recipient, appointment } = data;

  if (data.kind === "spiel_cancelled") {
    return noticeEmail(WORDS.cancelledSubject(dayOf(appointment.date)), origin, [
      around(WORDS.cancelled.before(paarung(appointment)), moment(appointment), WORDS.cancelled.after),
      WORDS.reinstated[recipient],
    ]);
  }

  const { moved_to: movedTo, asked_again: askedAgain } = data;

  // Taken off the fixture by the move: the void notice, naming the slot left alone.
  if (movedTo === null && !askedAgain) {
    if (recipient === "schiedsrichter") return unbookedEmail(appointment, origin);
    return noticeEmail(WORDS.voidSubject(dayOf(appointment.date)), origin, [
      around(WORDS.void.before(paarung(appointment)), moment(appointment), WORDS.void.after),
    ]);
  }

  const spiel = paarung(movedTo ?? appointment);
  const lead: Paragraph = askedAgain ? [WORDS.moved(spiel), WORDS.askedLater[recipient]] : [WORDS.moved(spiel)];
  const subjectLine = movedTo === null ? WORDS.movedFromSubject(dayOf(appointment.date)) : WORDS.movedSubject(dayOf(movedTo.date));

  return noticeEmail(subjectLine, origin, lead, { title: spiel, facts: moveFacts(appointment, movedTo) });
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
 * what is still to settle. No button, as every notice: the league writes again about each fixture.
 */
export function buildAustrittNoticeEmail({ team, saison_id: saison, spiele }: FLAustrittNoticeData, { origin }: MailOrigin): Mail {
  const words = SERVER_COPY.mail.austrittNotice;

  return noticeEmail(words.subject(team), origin, [[{ strong: team }, words.lead.after(saison)], words.spiele(spiele.length)], {
    title: COPY.page.spiele,
    facts: spiele.map((spiel) => ({
      label: COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time)),
      value: paarung(spiel),
    })),
  });
}
