import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDatumLong, formatDayAndTime, formatUhrzeit, timeOf } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { Fact, Mail, Paragraph, Sentence } from "./emailShell";
import type {
  FLSpielEinteilungData,
  FLSpielEinteilungLiftedData,
  FLSpielMailAnsetzung,
  FLSpielMailAppointment,
  FLSpielMovedData,
  FLSpielNoticeData,
  FLSpielRequestData,
  FLSpielVorschlagDiscardedData,
} from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.spiel;
const FACT = COPY.spielplan.fact;

/**
 * The one place this link is spelled. `token` is the name `nginx/shared/http.conf :: $credential_free_uri`
 * redacts, and the origin goes through `mailOrigin` here, so the link and the message's close stand on one host.
 */
export function spielBestaetigungsLink(origin: string, token: string): string {
  return `${mailOrigin(origin)}${ROUTES.spielbestaetigung.path()}?token=${encodeURIComponent(token)}`;
}

/** The referee's own panel, the address `fl_frontend/src/features/funktionen/utils.ts` opens their Funktion on. */
const SCHIEDSRICHTER_PANEL_PATH = "/area/schiedsrichter";

/** The fixture by its two sides in the fixture's own order, as the schedule lists them. */
const paarung = ({ team1, team2 }: FLSpielMailAppointment): Copy => COPY.page.spiel({ record: team1 }, { record: team2 });

const moment = ({ datum, uhrzeit }: FLSpielMailAppointment): string => formatDayAndTime(dayOf(datum), timeOf(uhrzeit));

/** A sentence whose moment stands semibold between its two parts. */
const around = (before: string, value: string, after: string): Sentence => [before, { strong: value }, after];

/** A move's rows: the moment it left, and the one it moved to where it holds one. */
function moveFacts(from: FLSpielMailAppointment, to: FLSpielMailAppointment | null): Fact[] {
  return [{ label: WORDS.previous, value: moment(from) }, ...(to === null ? [] : [{ label: WORDS.next, value: moment(to) }])];
}

/**
 * The fixture under its pairing, one fact to a row, so a reader scanning for the day finds it alone; after a move, the
 * moment left and the one moved to in the day's and the time's place.
 */
function slotBlock(ansetzung: FLSpielMailAnsetzung, movedFrom: FLSpielMailAppointment | null): NonNullable<Mail["block"]> {
  const { datum, uhrzeit, ort } = ansetzung;
  const when: Fact[] =
    movedFrom === null
      ? [
          { label: FACT.datum, value: formatDatumLong(dayOf(datum)) },
          { label: FACT.uhrzeit, value: formatUhrzeit(timeOf(uhrzeit)) },
        ]
      : moveFacts(movedFrom, ansetzung);

  // A ground nobody assigned, in words: a mail has no glyph for it.
  return { title: paarung(ansetzung), facts: [...when, { label: FACT.spielort, value: ort ?? COPY.shared.notProvided }] };
}

/** The deadline and the first-press rule: any seat of the club answers, so a reader told nothing takes a spent link for a dead one. */
const answerParagraph = (frist: string): Paragraph => [
  around(WORDS.answerUntil.before, formatDatumLong(dayOf(frist)), WORDS.answerUntil.after),
  WORDS.firstAnswerCounts,
];

/**
 * A club's request to confirm a fixture, the reminder of it, or the request about the slot a move went to, which is then
 * the one mail telling the club of the move: to one mailbox of one of its teams.
 */
export function buildSpielAnfrageEmail(
  { kind, team, ansetzung, frist, moved_from: movedFrom }: FLSpielRequestData,
  { origin, token }: MailLink,
): Mail {
  const day = dayOf(ansetzung.datum);
  const ask = WORDS.confirmAsk({ record: team });
  // A reminder carries no move: the move's own request is the one mail telling of it.
  const [subjectLine, lead]: readonly [string, Paragraph] =
    movedFrom !== null
      ? [WORDS.movedSubject(day), [WORDS.moved(paarung(ansetzung)), ask]]
      : kind === "spiel_reminder"
        ? [WORDS.reminderSubject(day), [WORDS.answerMissing({ record: team }), ask]]
        : [WORDS.requestSubject(day), [ask]];

  return {
    kind: "notice",
    subjectLine: subjectLine,
    // Through `mailOrigin` once, for the footer: the link is spelled by its own function, so a second derivation here
    // could send the two versions to different hosts.
    origin: mailOrigin(origin),
    vorname: "",
    paragraphs: [lead],
    block: slotBlock(ansetzung, movedFrom),
    afterBlock: [answerParagraph(frist)],
    button: { label: COPY.page.spielbestaetigung, href: spielBestaetigungsLink(origin, token) },
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
    subjectLine: movedFrom === null ? WORDS.bookedSubject(dayOf(ansetzung.datum)) : WORDS.movedSubject(dayOf(ansetzung.datum)),
    origin: site,
    vorname: "",
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
    subjectLine: WORDS.unbookedSubject(dayOf(appointment.datum)),
    origin: mailOrigin(origin),
    vorname: "",
    paragraphs: [[around(WORDS.unbooked.before(paarung(appointment)), moment(appointment), WORDS.unbooked.after)]],
  };
}

/** A notice naming a fixture, the reader's next mail, if any, being the request or the Einteilung it states. */
function noticeEmail(subjectLine: string, origin: string, paragraph: Paragraph, block?: Mail["block"]): Mail {
  return {
    kind: "notice",
    subjectLine: subjectLine,
    origin: mailOrigin(origin),
    vorname: "",
    paragraphs: [paragraph],
    ...(block ? { block } : {}),
  };
}

/**
 * The word that a fixture a party was asked about moved where no request about its new slot goes now, or was called off:
 * the slot it was asked about, and on a move the slot it went to where it holds one. No button and no name, nothing
 * being left to answer here and the address perhaps having changed hands since the request.
 */
export function buildSpielHinweisEmail(data: FLSpielMovedData | FLSpielNoticeData, { origin }: MailOrigin): Mail {
  const { recipient, appointment } = data;

  if (data.kind === "spiel_abgesagt") {
    return noticeEmail(WORDS.cancelledSubject(dayOf(appointment.datum)), origin, [
      around(WORDS.cancelled.before(paarung(appointment)), moment(appointment), WORDS.cancelled.after),
      WORDS.reinstated[recipient],
    ]);
  }

  const { moved_to: movedTo, asked_again: askedAgain } = data;

  // Taken off the fixture by the move: the void notice, naming the slot left alone.
  if (movedTo === null && !askedAgain) {
    if (recipient === "schiedsrichter") return unbookedEmail(appointment, origin);
    return noticeEmail(WORDS.voidSubject(dayOf(appointment.datum)), origin, [
      around(WORDS.void.before(paarung(appointment)), moment(appointment), WORDS.void.after),
    ]);
  }

  const spiel = paarung(movedTo ?? appointment);
  const lead: Paragraph = askedAgain ? [WORDS.moved(spiel), WORDS.askedLater[recipient]] : [WORDS.moved(spiel)];
  const subjectLine = movedTo === null ? WORDS.movedFromSubject(dayOf(appointment.datum)) : WORDS.movedSubject(dayOf(movedTo.datum));

  return noticeEmail(subjectLine, origin, lead, { title: spiel, facts: moveFacts(appointment, movedTo) });
}

/** The word to a referee that their Einteilung is lifted, whoever took them off the fixture. */
export function buildSpielEinteilungAufgehobenEmail({ appointment }: FLSpielEinteilungLiftedData, { origin }: MailOrigin): Mail {
  return unbookedEmail(appointment, origin);
}

/**
 * The word to a club that the league kept the date it declined and proposed another for: its answer said the league
 * decides, and nothing else tells it the league has.
 */
export function buildSpielVorschlagVerworfenEmail({ appointment }: FLSpielVorschlagDiscardedData, { origin }: MailOrigin): Mail {
  return noticeEmail(WORDS.keptSubject(dayOf(appointment.datum)), origin, [
    around(WORDS.kept.before(paarung(appointment)), moment(appointment), WORDS.kept.after),
    WORDS.keptDiscarded,
  ]);
}
