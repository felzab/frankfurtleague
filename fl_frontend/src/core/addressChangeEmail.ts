import "server-only";

import { ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAITING_PERIOD, HOLDER_WAIT } from "./addressChange";
import { ACCOUNT_COPY } from "./copy/account";
import { COPY } from "./copy/shared";
import { formatInstant } from "./format";
import { mailedLinkTo, ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type {
  FLAddressChangeDiscardedData,
  FLAddressChangeEffectiveData,
  FLAddressChangeLinkData,
  FLAddressChangeNoticeData,
} from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.addressChange;

/** Both mails of the person's own change state the link's lifetime, which the backend refuses past. */
const LINK_VALID: Paragraph = [SERVER_COPY.mail.linkValidFor(ADDRESS_CHANGE_VALID_HOURS)];

/**
 * The link to the new address, asking only whether the mailbox is theirs. It names no record, the change moving every
 * one.
 */
export function buildAddressChangeEmail({ way, holder }: FLAddressChangeLinkData, { origin, token }: MailLink): Mail {
  // One wording for the mail's subject, its button and the title of the page the button opens.
  const subjectLine = COPY.shared.withObject(COPY.shared.emailAddress, "confirm");
  const button = { label: subjectLine, href: mailedLinkTo(origin, ROUTES.addressChangeConfirmation, token) };

  // The person's own change, the address on file having confirmed it first: the page's question, its title the button.
  if (way === "account") {
    return {
      audience: "security",
      subjectLine,
      origin,
      paragraphs: [
        holder === null ? [WORDS.new.question] : [WORDS.new.question, ACCOUNT_COPY.address.holderWait(HOLDER_WAIT[holder])],
        LINK_VALID,
      ],
      button,
    };
  }

  return {
    audience: "security",
    subjectLine,
    origin,
    paragraphs: [[SERVER_COPY.mail.addressChange.administrator.lead, WORDS.new.waits(ADDRESS_CHANGE_WAITING_PERIOD)], LINK_VALID],
    button,
  };
}

/**
 * The mail to the address on file. It names no new address, which the page its link opens shows: the change may be
 * somebody else's mistake or a pretext, and a mail travels further than the page it links.
 */
export function buildAddressChangeNoticeEmail({ way, holder }: FLAddressChangeNoticeData, { origin, token: stopToken }: MailLink): Mail {
  // The person's own change asks the address on file first: its link confirms or declines the change.
  if (way === "account") {
    // One wording for the mail's subject and its button, the act the mail asks for.
    const confirm = COPY.shared.withObject(WORDS.change, "confirm");
    return {
      audience: "security",
      subjectLine: confirm,
      origin,
      paragraphs: [
        [
          WORDS.previous.question,
          holder === null ? SERVER_COPY.mail.addressChange.previousEffect : ACCOUNT_COPY.address.holderWait(HOLDER_WAIT[holder]),
        ],
        LINK_VALID,
      ],
      button: { label: confirm, href: mailedLinkTo(origin, ROUTES.addressChangeConfirmation, stopToken) },
    };
  }

  const { noticeSubject, noticeLead, noticeWait, noticeStop } = SERVER_COPY.mail.addressChange.administrator;
  return {
    audience: "security",
    // Telling of the change and asking nothing: a real holder refuses a pretext by the stop alone.
    subjectLine: noticeSubject,
    origin,
    paragraphs: [[noticeLead, noticeWait(ADDRESS_CHANGE_WAITING_PERIOD), noticeStop]],
    // The stop: no link approves anything.
    button: { label: ACCOUNT_COPY.address.stop, href: mailedLinkTo(origin, ROUTES.addressChangeConfirmation, stopToken) },
  };
}

/**
 * The completion notice: no control and no new address. The way to repudiate the change (NIST SP 800-63B-4:
 * "clear instructions, including contact information") is the security audience's own last line.
 */
export function buildAddressChangeEffectiveEmail({ instant }: FLAddressChangeEffectiveData, { origin }: MailOrigin): Mail {
  const { subject, lead } = SERVER_COPY.mail.addressChange.effective;
  return {
    audience: "security",
    subjectLine: subject,
    origin,
    // Never says the old address stops signing in: a seat not yet confirmed stays behind and still signs in there.
    paragraphs: [[lead(formatInstant(instant))]],
  };
}

/**
 * The new mailbox's notice that a confirmed change did not take effect at its time. No reason: the holder of the
 * address may be a stranger.
 */
export function buildAddressChangeDiscardedEmail(_data: FLAddressChangeDiscardedData, { origin }: MailOrigin): Mail {
  const { subject, lead } = SERVER_COPY.mail.addressChange.discarded;
  return {
    audience: "security",
    subjectLine: subject,
    origin,
    paragraphs: [[lead]],
  };
}
