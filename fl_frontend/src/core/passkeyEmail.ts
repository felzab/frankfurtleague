import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { formatInstant } from "./format";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";

const { passkeyAdded, passkeyRemoved } = SERVER_COPY.mail;

/** The subject and the sentences of one event; nothing here names a row or a device. */
interface PasskeyEvent {
  readonly subject: string;
  readonly paragraph: (time: string) => Paragraph;
}

const ADDED: PasskeyEvent = {
  subject: passkeyAdded.subject,
  paragraph: (time) => [[`${passkeyAdded.lead.before} `, { strong: time }, ` ${passkeyAdded.lead.after}`]],
};

const ERASED: PasskeyEvent = {
  subject: passkeyRemoved.subject,
  // Only the devices that passkey signed in: a removal ends the sessions carrying its credential and
  // leaves every other standing (`fl_frontend/src/core/auth/passkeys.ts :: removePasskey`).
  paragraph: (time) => [[`${passkeyRemoved.lead.before} `, { strong: time }, ` ${passkeyRemoved.lead.after}`], passkeyRemoved.devices],
};

/** What a builder is handed; `account` is a path on `origin`, the account's Sicherheit page, which the row carries. */
type Anlass = { instant: Date; origin: string; account: string };

function build(event: PasskeyEvent, { instant, origin, account }: Anlass): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "security",
    subjectLine: event.subject,
    origin: site,
    vorname: "",
    paragraphs: [event.paragraph(formatInstant(instant))],
    // The one place either event can be acted on.
    button: { label: COPY.shared.end.toAccount, href: `${site}${account}` },
  };
}

export function buildPasskeyAddedEmail(anlass: Anlass): Mail {
  return build(ADDED, anlass);
}

export function buildPasskeyErasedEmail(anlass: Anlass): Mail {
  return build(ERASED, anlass);
}
