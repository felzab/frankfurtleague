import "server-only";

import { DECLINED_RETENTION_DAYS } from "./bounds";
import { COPY, rollenText } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDateLong } from "./format";
import { kontaktConfirmationLink } from "./kontaktLink";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";
import { TRIKOT_FARBEN } from "./teamVocabulary";

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

/** A seat's own last day set semibold, in the words of the page's `applicationDeadline`: each seat holds its own day. */
const deadlineSentence = (deadline: string): Sentence => [
  WORDS.deadline.before,
  { strong: formatDateLong(dayOf(deadline)) },
  WORDS.deadline.after,
];

/** A fill named by its hex, in this shape alone: no supplier could match any other. */
const FARBE_HEX = /^#[0-9a-f]{6}$/i;

/** What an accepted application is told, each person naming the seats they were entered for. */
export function buildBewerbungZusageEmail(
  { team, shorthand, saison_id, rollen, gruppe, trikot_farbe }: FLBewerbungZusageData,
  { origin }: MailOrigin,
): Mail {
  const site = mailOrigin(origin);
  const farbe = TRIKOT_FARBEN.find((entry) => entry.value === trikot_farbe);
  const hex = farbe !== undefined && FARBE_HEX.test(farbe.hex) ? farbe.hex : null;

  return {
    kind: "notice",
    subjectLine: WORDS.zusage.subject(saison_id),
    origin: site,
    paragraphs: [[[{ strong: team }, WORDS.zusage.lead.after(saison_id)], WORDS.zusage.lead.welcome]],
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
          value: farbe === undefined ? COPY.shared.notProvided : hex === null ? farbe.label : `${farbe.label} (${hex})`,
        },
        // The one row that differs per reader: each person is told the seats they were entered for.
        { label: WORDS.registeredAs, value: rollenText(rollen) },
      ],
    },
    afterBlock: [[farbe === undefined ? WORDS.zusage.fixedNoColour : WORDS.zusage.fixed], [WORDS.zusage.signIn]],
    button: { label: COPY.shared.verb.signIn, href: `${site}${ROUTES.signIn.path()}` },
  };
}

/** The decision and the reason it was given, unabridged and last: the one thing the mail exists to hand over. */
export function buildBewerbungAbsageEmail({ team, saison_id, rollen, reason }: FLBewerbungAbsageData, { origin }: MailOrigin): Mail {
  return {
    kind: "notice",
    subjectLine: WORDS.absage.subject(saison_id),
    origin: mailOrigin(origin),
    paragraphs: [
      [
        [WORDS.absage.lead.before, { strong: team }, WORDS.absage.lead.after(saison_id)],
        WORDS.absage.decision,
        WORDS.absage.deletion(DECLINED_RETENTION_DAYS),
      ],
    ],
    block: {
      title: WORDS.absage.title,
      facts: [
        // Identification rather than a verdict: it says why the mail reached this reader.
        { label: WORDS.registeredAs, value: rollenText(rollen) },
        { label: COPY.admin.spiel.reason, value: reason },
      ],
    },
  };
}

/** What one person is asked to confirm: every seat they hold, answered through the one link. */
export function buildBewerbungConfirmationEmail(
  { saison_id, schule, rollen, deadline }: FLBewerbungLinkData,
  { origin, token }: MailLink,
): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "firstContact",
    subjectLine: WORDS.link.subject(saison_id),
    origin: site,
    paragraphs: [[WORDS.link.lead(schule), WORDS.confirmOrOppose], [deadlineSentence(deadline)]],
    block: {
      title: WORDS.entry,
      facts: [
        { label: COPY.shared.saison, value: saison_id },
        { label: WORDS.registeredAs, value: rollenText(rollen) },
      ],
    },
    button: { label: COPY.page.entryConfirmation, href: kontaktConfirmationLink(site, token) },
  };
}

export function buildBewerbungReminderEmail({ saison_id, schule, deadline }: FLBewerbungLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "firstContact",
    subjectLine: WORDS.reminder.subject(saison_id),
    origin: site,
    paragraphs: [[WORDS.reminder.lead(schule), WORDS.confirmOrOppose], [deadlineSentence(deadline)]],
    // A fresh link, minted beside the first one rather than in place of it: a reminder that voided
    // the link somebody is still looking at would punish the reader it is chasing.
    button: { label: COPY.page.entryConfirmation, href: kontaktConfirmationLink(site, token) },
  };
}

/**
 * The Ansprechperson's link mail, a first contact as every seat's is: the address was typed into a form, and nothing
 * says its reader typed it. `pending` names the other seats by role alone and the mail names no school, so a mistyped
 * address hands a stranger nobody.
 */
export function buildBewerbungReceivedEmail(
  { saison_id, rollen, pending, deadline }: FLBewerbungReceivedData,
  { origin, token }: MailLink,
): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "firstContact",
    subjectLine: WORDS.received.subject(saison_id),
    origin: site,
    paragraphs: [
      [WORDS.received.lead(saison_id), WORDS.received.named(rollen), WORDS.confirmOrOppose],
      [WORDS.received.others],
      [deadlineSentence(deadline)],
    ],
    block: {
      title: WORDS.status,
      facts: [
        { label: COPY.shared.saison, value: saison_id },
        { label: WORDS.received.pending, value: rollenText(pending) },
      ],
    },
    button: { label: COPY.page.entryConfirmation, href: kontaktConfirmationLink(site, token) },
  };
}

/** The one deletion notice, the application's arm where it names a season and the account's where it names none. */
export function buildDeletionNoticeEmail({ saison_id }: FLDeletionNoticeData, { origin }: MailOrigin): Mail {
  const site = mailOrigin(origin);

  if (saison_id === null) {
    return {
      kind: "notice",
      subjectLine: SERVER_COPY.accountErasure.done,
      origin: site,
      paragraphs: [[SERVER_COPY.mail.deletion.account]],
    };
  }

  return {
    kind: "notice",
    subjectLine: WORDS.erasure.subject(saison_id),
    origin: site,
    paragraphs: [[SERVER_COPY.mail.deletion.bewerbung.lead(saison_id), SERVER_COPY.mail.deletion.bewerbung.deleted], [WORDS.erasure.again]],
    button: toBewerbung(site, saison_id),
  };
}

/**
 * What the Ansprechperson is told when a person refuses their entry, by the seats it emptied.
 * No button: the next step is „Sitz bearbeiten“, the league's, and a reply reaches its mailbox.
 */
export function buildBewerbungObjectionEmail(
  { saison_id, rollen, declined, deadline }: FLBewerbungObjectionData,
  { origin }: MailOrigin,
): Mail {
  const seats = rollenText(declined);

  return {
    kind: "notice",
    subjectLine: WORDS.objection.subject(saison_id),
    origin: mailOrigin(origin),
    paragraphs: [
      [[WORDS.objection.lead.before, { strong: seats }, WORDS.objection.lead.after], WORDS.objection.removed],
      [WORDS.objection.replace, [WORDS.objection.until.before, { strong: formatDateLong(dayOf(deadline)) }, WORDS.objection.until.after]],
    ],
    block: {
      title: WORDS.status,
      facts: [
        { label: COPY.shared.saison, value: saison_id },
        { label: WORDS.registeredAs, value: rollenText(rollen) },
        { label: WORDS.objection.from, value: seats },
      ],
    },
  };
}
