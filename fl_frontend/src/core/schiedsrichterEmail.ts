import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDateLong } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";
import type { FLSchiedsrichterConfirmationData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

/**
 * The one place the referee's confirmation link is spelled. `token` is the parameter name because the edge's
 * `$credential_free_uri` matches that name; a second spelling reaches the access line and the referer unredacted.
 */
function schiedsrichterConfirmationLink(origin: string, token: string): string {
  return `${origin}${ROUTES.schiedsrichterConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

const PAGE = SERVER_COPY.schiedsrichterConfirmation;

// No season: a referee's entry is bound to none, so the deadline is the only date here.
/**
 * What one referee is asked to confirm, from the facts the Postausgang row holds and the link its hand-out minted: the
 * page's title and its opening and deadline sentences. `origin` is the serving origin, never `SITE_URL`; `token` is a
 * bearer credential and is never taken apart here.
 */
export function buildSchiedsrichterConfirmationEmail({ deadline }: FLSchiedsrichterConfirmationData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  return {
    // A first contact, so the shell closes on the „not you“ line and the objection.
    kind: "firstContact",
    subjectLine: COPY.page.entryConfirmation,
    origin: site,
    // Both answers named before the press, in the sentence a contact seat's mail asks them in; then the deadline, its
    // day semibold, as the board draws it, between the page's two parts around it.
    paragraphs: [
      [PAGE.opening, SERVER_COPY.mail.bewerbung.confirmOrOppose],
      [[PAGE.deadline.before, { strong: formatDateLong(dayOf(deadline)) }, PAGE.deadline.after]],
    ],
    button: { label: COPY.page.entryConfirmation, href: schiedsrichterConfirmationLink(site, token) },
  };
}
