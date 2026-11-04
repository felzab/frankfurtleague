import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { formatInstant } from "./format";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";

const { passkeyAdded, passkeyRemoved } = SERVER_COPY.mail;

/** The subject and the sentences of one event; nothing here names a row or a device. */
interface Ereignis {
  readonly subject: string;
  readonly paragraph: (zeit: string) => Paragraph;
}

const HINZUGEFUEGT: Ereignis = {
  subject: passkeyAdded.subject,
  paragraph: (zeit) => [[`${passkeyAdded.lead.before} `, { strong: zeit }, ` ${passkeyAdded.lead.after}`]],
};

const GELOESCHT: Ereignis = {
  subject: passkeyRemoved.subject,
  // Only the devices that passkey signed in: a removal ends the sessions carrying its credential and
  // leaves every other standing (`fl_frontend/src/core/auth/passkeys.ts :: removePasskey`).
  paragraph: (zeit) => [[`${passkeyRemoved.lead.before} `, { strong: zeit }, ` ${passkeyRemoved.lead.after}`], passkeyRemoved.devices],
};

/** What a builder is handed; `konto` is a path on `origin`, the account's Sicherheit page, which the row carries. */
type Anlass = { zeitpunkt: Date; origin: string; konto: string };

function build(ereignis: Ereignis, { zeitpunkt, origin, konto }: Anlass): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "security",
    subjectLine: ereignis.subject,
    origin: site,
    vorname: "",
    paragraphs: [ereignis.paragraph(formatInstant(zeitpunkt))],
    // The one place either event can be acted on.
    button: { label: COPY.shared.end.toAccount, href: `${site}${konto}` },
  };
}

export function buildPasskeyHinzugefuegtEmail(anlass: Anlass): Mail {
  return build(HINZUGEFUEGT, anlass);
}

export function buildPasskeyGeloeschtEmail(anlass: Anlass): Mail {
  return build(GELOESCHT, anlass);
}
