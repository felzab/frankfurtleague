import "server-only";

import { COPY } from "./copy/shared";
import { formatInstant } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { Mail, Paragraph } from "./emailShell";

const { passkeyAdded, passkeyRemoved } = SERVER_COPY.mail;

/** The subject and the sentences of one event; nothing here names a row or a device. */
interface PasskeyEvent {
  readonly subject: Copy;
  readonly paragraph: (time: string) => Paragraph;
}

const ADDED: PasskeyEvent = {
  subject: passkeyAdded.subject,
  paragraph: (time) => [passkeyAdded.lead(time)],
};

const ERASED: PasskeyEvent = {
  subject: passkeyRemoved.subject,
  // Only the devices that passkey signed in: a removal ends the sessions carrying its credential and
  // leaves every other standing.
  paragraph: (time) => [passkeyRemoved.lead(time), passkeyRemoved.devices],
};

type Occasion = { instant: Date; origin: string };

function build(event: PasskeyEvent, { instant, origin }: Occasion): Mail {
  return {
    audience: "security",
    subjectLine: event.subject,
    origin,
    paragraphs: [event.paragraph(formatInstant(instant))],
    // The one place either event can be acted on.
    button: { label: COPY.shared.end.toAccount, href: `${origin}${ROUTES.accountSecurity.path()}` },
  };
}

export function buildPasskeyAddedEmail(occasion: Occasion): Mail {
  return build(ADDED, occasion);
}

export function buildPasskeyErasedEmail(occasion: Occasion): Mail {
  return build(ERASED, occasion);
}
