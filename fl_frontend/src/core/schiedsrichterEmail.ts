import "server-only";

import { COPY } from "./copy/shared";
import { dayOf, formatDateLong } from "./format";
import { mailedLinkTo, ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";
import type { FLSchiedsrichterConfirmationData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

const PAGE = SERVER_COPY.schiedsrichterConfirmation;

/**
 * What one referee is asked to confirm, from the facts the Postausgang row holds and the link its hand-out minted: the
 * page's title and its opening and deadline sentences. No season: a referee's entry is bound to none, so the deadline
 * is the only date here. `origin` is the serving origin, never `SITE_URL`; `token` is a bearer credential and is never
 * taken apart here.
 */
export function buildSchiedsrichterConfirmationEmail({ deadline }: FLSchiedsrichterConfirmationData, { origin, token }: MailLink): Mail {
  return {
    // A first contact, so the shell closes on the „not you“ line and the objection.
    audience: "firstContact",
    subjectLine: COPY.page.entryConfirmation,
    origin,
    // Both answers named before the press, in the sentence a contact seat's mail asks them in; then the page's
    // deadline, its day semibold.
    paragraphs: [[PAGE.opening, SERVER_COPY.mail.bewerbung.confirmOrOppose], [PAGE.deadline(formatDateLong(dayOf(deadline)))]],
    button: { label: COPY.page.entryConfirmation, href: mailedLinkTo(origin, ROUTES.schiedsrichterConfirmation, token) },
  };
}
