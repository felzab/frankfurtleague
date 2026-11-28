import "server-only";

import { CONFIRMATION_DEADLINE_DAYS } from "./bounds";
import { seatsText } from "./copy";
import { COPY } from "./copy/shared";
import { dayOf, formatDateLong } from "./format";
import { mailedLinkTo, ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";
import { TRIKOT_FARBEN } from "./trikotFarben";

import type { Mail, Sentence } from "./emailShell";
import type {
  FLBewerbungAbsageData,
  FLBewerbungLinkData,
  FLBewerbungObjectionData,
  FLBewerbungReceivedData,
  FLBewerbungZusageData,
  FLDeletionNoticeData,
} from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.bewerbung;

/**
 * Where a school starts again. The id is percent-encoded rather than interpolated raw: it lands in
 * an href, and `escapeHtml` guards an HTML context rather than a URL's own syntax.
 */
const toBewerbung = (origin: string, saisonId: string) => ({
  label: SERVER_COPY.landing.toBewerbung,
  href: `${origin}${ROUTES.bewerbung.path(encodeURIComponent(saisonId))}`,
});

/** A seat's own last day set semibold: each seat holds its own day. */
const deadlineSentence = (deadline: string): Sentence => WORDS.deadline(formatDateLong(dayOf(deadline)));

/** What an accepted application is told, each person naming the seats they were entered for. */
export function buildBewerbungZusageEmail(
  { team, shorthand, saison_id, seats, gruppe, trikot_farbe }: FLBewerbungZusageData,
  { origin }: MailOrigin,
): Mail {
  const farbe = TRIKOT_FARBEN.find((entry) => entry.value === trikot_farbe);

  return {
    audience: "notice",
    subjectLine: WORDS.zusage.subject(saison_id),
    origin,
    paragraphs: [[WORDS.zusage.lead(team, saison_id), WORDS.zusage.welcome]],
    block: {
      title: COPY.shared.saisonName(saison_id),
      facts: [
        { label: COPY.shared.facts.team, value: team },
        { label: COPY.team.shorthand, value: shorthand },
        { label: COPY.team.gruppe, value: gruppe },
        // A row either way: an absent colour is a fact the reader has to be able to find where a named one stands. The
        // hex beside the name: the name alone leaves neighbours such as Grün and Smaragd for a supplier to guess between.
        {
          label: COPY.team.trikotFarbe,
          value: farbe === undefined ? COPY.shared.notProvided : `${farbe.label} (${farbe.hex})`,
        },
        // The one row that differs per reader: each person is told the seats they were entered for.
        { label: WORDS.registeredAs, value: seatsText(seats) },
      ],
    },
    afterBlock: [[farbe === undefined ? WORDS.zusage.fixedNoColour : WORDS.zusage.fixed], [WORDS.zusage.signIn]],
    button: { label: COPY.shared.verb.signIn, href: `${origin}${ROUTES.signIn.path()}` },
  };
}

/** The decision and the reason it was given, unabridged and last: the one thing the mail exists to hand over. */
export function buildBewerbungAbsageEmail({ team, saison_id, seats, reason }: FLBewerbungAbsageData, { origin }: MailOrigin): Mail {
  return {
    audience: "notice",
    subjectLine: WORDS.absage.subject(saison_id),
    origin,
    paragraphs: [[WORDS.absage.lead(team, saison_id), WORDS.absage.decision, WORDS.absage.deletion(CONFIRMATION_DEADLINE_DAYS)]],
    block: {
      title: WORDS.absage.title,
      facts: [
        // Identification rather than a verdict: it says why the mail reached this reader.
        { label: WORDS.registeredAs, value: seatsText(seats) },
        { label: COPY.shared.reason, value: reason },
      ],
    },
  };
}

/** The confirmation page's own opening, naming the season and every seat the reader holds in the application. */
const openingOf = (saison: string, seats: FLBewerbungLinkData["seats"]) =>
  SERVER_COPY.kontaktConfirmation.opening.named(saison, COPY.team.seatsHeld(seats));

/** What one person is asked to confirm: every seat they hold, answered through the one link. */
export function buildBewerbungConfirmationEmail({ saison_id, seats, deadline }: FLBewerbungLinkData, { origin, token }: MailLink): Mail {
  return {
    audience: "firstContact",
    subjectLine: WORDS.link.subject(saison_id),
    origin,
    paragraphs: [[openingOf(saison_id, seats), WORDS.confirmOrOppose], [deadlineSentence(deadline)]],
    button: { label: COPY.page.entryConfirmation, href: mailedLinkTo(origin, ROUTES.kontaktConfirmation, token) },
  };
}

export function buildBewerbungReminderEmail({ saison_id, seats, deadline }: FLBewerbungLinkData, { origin, token }: MailLink): Mail {
  return {
    audience: "firstContact",
    subjectLine: WORDS.reminder.subject(saison_id),
    origin,
    paragraphs: [[openingOf(saison_id, seats), WORDS.reminder.missing, WORDS.confirmOrOppose], [deadlineSentence(deadline)]],
    // A fresh link, minted beside the first one rather than in place of it: a reminder that voided
    // the link somebody is still looking at would punish the reader it is chasing.
    button: { label: COPY.page.entryConfirmation, href: mailedLinkTo(origin, ROUTES.kontaktConfirmation, token) },
  };
}

/**
 * The Ansprechperson's link mail, a first contact as every seat's is: the address was typed into a form, and nothing
 * says its reader typed it. `pending` names the other seats and none of their holders, and the mail names no school,
 * so a mistyped address hands a stranger nobody.
 */
export function buildBewerbungReceivedEmail(
  { saison_id, seats, pending, deadline }: FLBewerbungReceivedData,
  { origin, token }: MailLink,
): Mail {
  return {
    audience: "firstContact",
    subjectLine: WORDS.received.subject(saison_id),
    origin,
    paragraphs: [
      [WORDS.received.lead(saison_id), WORDS.received.named(seats), WORDS.confirmOrOppose],
      [WORDS.received.others],
      [deadlineSentence(deadline)],
    ],
    block: {
      title: WORDS.status,
      facts: [
        { label: COPY.shared.saison, value: COPY.shared.saisonName(saison_id) },
        { label: WORDS.received.pending, value: seatsText(pending) },
      ],
    },
    button: { label: COPY.page.entryConfirmation, href: mailedLinkTo(origin, ROUTES.kontaktConfirmation, token) },
  };
}

/** The one deletion notice, the application's arm where it names a season and the account's where it names none. */
export function buildDeletionNoticeEmail({ saison_id }: FLDeletionNoticeData, { origin }: MailOrigin): Mail {
  if (saison_id === null) {
    return {
      audience: "notice",
      subjectLine: SERVER_COPY.accountErasure.done,
      origin,
      paragraphs: [[SERVER_COPY.mail.deletion.account]],
    };
  }

  return {
    audience: "notice",
    subjectLine: WORDS.erasure.subject(saison_id),
    origin,
    paragraphs: [[SERVER_COPY.mail.deletion.bewerbung.lead(saison_id), SERVER_COPY.mail.deletion.bewerbung.deleted], [WORDS.erasure.again]],
    button: toBewerbung(origin, saison_id),
  };
}

/**
 * What the Ansprechperson is told when a person refuses their entry, by the seats it emptied.
 * No button: the next step is „Sitz bearbeiten“, the league's, and a reply reaches its mailbox.
 */
export function buildBewerbungObjectionEmail({ saison_id, seats, declined, deadline }: FLBewerbungObjectionData, { origin }: MailOrigin): Mail {
  const emptied = seatsText(declined);

  return {
    audience: "notice",
    subjectLine: WORDS.objection.subject(saison_id),
    origin,
    paragraphs: [
      [WORDS.objection.lead(emptied), WORDS.objection.removed],
      [WORDS.objection.replace, WORDS.objection.until(formatDateLong(dayOf(deadline)))],
    ],
    block: {
      title: WORDS.status,
      facts: [
        { label: COPY.shared.saison, value: COPY.shared.saisonName(saison_id) },
        { label: WORDS.registeredAs, value: seatsText(seats) },
        { label: WORDS.objection.from, value: emptied },
      ],
    },
  };
}
