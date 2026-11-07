import "server-only";

import { ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAIT_DAYS, HOLDER_WAIT } from "./addressChange";
import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { formatInstant } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Wait } from "./copy";
import type { Mail, Paragraph } from "./emailShell";
import type {
  FLAddressChangeDiscardedData,
  FLAddressChangeEffectiveData,
  FLAddressChangeLinkData,
  FLAddressChangeNoticeData,
} from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

/**
 * The one spelling of the address page's link, the stop link's too, the page telling them apart by hash.
 * `token`, because `nginx/shared/http.conf :: $credential_free_uri` redacts that name alone.
 */
function addressChangeLink(origin: string, token: string): string {
  return `${origin}${ROUTES.addressChangeConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

const WORDS = SERVER_COPY.addressChange;

/** Both mails of the person's own change state the link's lifetime, which the backend refuses past. */
const LINK_VALID: Paragraph = [SERVER_COPY.mail.linkValidFor(ADDRESS_CHANGE_VALID_HOURS)];

/** The lost-mailbox change's wait, which both its mails state. */
const LOST_MAILBOX_WAIT: Wait = { days: ADDRESS_CHANGE_WAIT_DAYS };

/**
 * The link to the new address, asking only whether the mailbox is theirs. It greets nobody: behind a
 * mistyped address its reader is a stranger. It names no record, the change moving every one.
 */
export function buildAddressChangeEmail({ way, holder }: FLAddressChangeLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);
  const button = { label: COPY.shared.withObject(COPY.signIn.address, "confirm"), href: addressChangeLink(site, token) };
  const subjectLine = COPY.shared.withObject(WORDS.newAddress, "confirm");

  // The person's own change, the address on file having confirmed it first: the page's question, its title the button.
  if (way === "account") {
    return {
      kind: "security",
      subjectLine,
      origin: site,
      firstName: "",
      paragraphs: [
        holder === null ? [WORDS.new.question] : [WORDS.new.question, COPY.account.address.holderWait(HOLDER_WAIT[holder])],
        LINK_VALID,
      ],
      button,
    };
  }

  return {
    kind: "security",
    subjectLine,
    origin: site,
    firstName: "",
    paragraphs: [[SERVER_COPY.mail.addressChange.administrator.lead, WORDS.new.waits(LOST_MAILBOX_WAIT)], LINK_VALID],
    button,
  };
}

/**
 * The mail to the address on file. It names no new address, which the page its link opens shows: the change may be
 * somebody else's mistake or a pretext, and a mail travels further than the page it links.
 */
export function buildAddressChangeNoticeEmail(
  { way, first_name: firstName, holder }: FLAddressChangeNoticeData,
  { origin, token: stopToken }: MailLink,
): Mail {
  const site = mailOrigin(origin);

  // The person's own change asks the address on file first: its link confirms or declines the change.
  if (way === "account") {
    return {
      kind: "security",
      subjectLine: COPY.page.addressChangeConfirmation,
      origin: site,
      firstName: firstName ?? "",
      paragraphs: [
        [
          WORDS.previous.question,
          holder === null ? SERVER_COPY.mail.addressChange.previousEffect : COPY.account.address.holderWait(HOLDER_WAIT[holder]),
        ],
        LINK_VALID,
      ],
      button: { label: COPY.shared.withObject(WORDS.change, "confirm"), href: addressChangeLink(site, stopToken) },
    };
  }

  const { noticeSubject, noticeLead, noticeWait, noticeStop } = SERVER_COPY.mail.addressChange.administrator;
  return {
    kind: "security",
    // Telling of the change and asking nothing: a real holder refuses a pretext by the stop alone.
    subjectLine: noticeSubject,
    origin: site,
    firstName: firstName ?? "",
    paragraphs: [[noticeLead, noticeWait(LOST_MAILBOX_WAIT), noticeStop]],
    // The stop: no link approves anything.
    button: { label: COPY.account.address.stop, href: addressChangeLink(site, stopToken) },
  };
}

/**
 * The completion notice: no control and no new address. The way to repudiate the change (NIST SP 800-63B-4,
 * read 2026-10-20: "clear instructions, including contact information") is the security kind's own last line.
 */
export function buildAddressChangeEffectiveEmail(
  { first_name: firstName, instant }: FLAddressChangeEffectiveData,
  { origin }: MailOrigin,
): Mail {
  const { subject, lead } = SERVER_COPY.mail.addressChange.effective;
  return {
    kind: "security",
    subjectLine: subject,
    origin: mailOrigin(origin),
    firstName: firstName ?? "",
    // Never says the old address stops signing in: a seat not yet confirmed stays behind and still signs in there.
    paragraphs: [[[`${lead.before} `, { strong: formatInstant(instant) }, ` ${lead.after}`]]],
  };
}

/**
 * The new mailbox's notice that a confirmed change did not take effect at its time. No name, no reason: the holder of
 * the address may be a stranger.
 */
export function buildAddressChangeDiscardedEmail(_data: FLAddressChangeDiscardedData, { origin }: MailOrigin): Mail {
  const { subject, lead } = SERVER_COPY.mail.addressChange.discarded;
  return {
    kind: "security",
    subjectLine: subject,
    origin: mailOrigin(origin),
    firstName: "",
    paragraphs: [[lead]],
  };
}
