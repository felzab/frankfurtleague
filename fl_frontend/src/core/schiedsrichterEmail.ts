import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDatumLong } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";
import type { FLSchiedsrichterConfirmationData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

/**
 * The one place the referee's confirmation link is spelled. `token` is the parameter name because
 * `nginx/shared/http.conf :: $credential_free_uri` matches that name; a second spelling reaches the access
 * line and the referer unredacted.
 */
function schiedsrichterBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${ROUTES.schiedsrichterConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

const PAGE = SERVER_COPY.schiedsrichterConfirmation;

// No name: an administrator typed this address and nobody has confirmed it, so behind a typo its
// reader is a stranger, owed none. No season: a referee's entry is bound to none, so the deadline is
// the only date here.
/**
 * What one referee is asked to confirm, from the facts the Postausgang row holds and the link its hand-out minted: the
 * page's title and its opening and deadline sentences, as the erasure mail takes its page's words. `origin` is the
 * serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`; `token` is a bearer credential and is never taken
 * apart here.
 */
export function buildSchiedsrichterBestaetigungEmail({ frist }: FLSchiedsrichterConfirmationData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  return {
    // A first contact, so the shell closes on the „not you“ line and the objection.
    kind: "firstContact",
    subjectLine: COPY.page.entryConfirmation,
    origin: site,
    vorname: "",
    // The deadline's day semibold, as the board draws it, between the page's two parts around it.
    paragraphs: [[PAGE.opening, [`${PAGE.deadline.before} `, { strong: formatDatumLong(dayOf(frist)) }, PAGE.deadline.after]]],
    button: { label: COPY.page.entryConfirmation, href: schiedsrichterBestaetigungsLink(site, token) },
  };
}
