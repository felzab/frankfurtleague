import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";

/**
 * The one figure the sign-in library expires the deletion link on and this message states.
 */
export const ERASURE_LINK_VALID_HOURS = 24;

const WORDS = SERVER_COPY.mail.erasureLink;

/**
 * The one place the deletion link is spelled, from the token alone and never the library's own `url`,
 * which deletes on a GET. `token` is the name the edge's `$credential_free_uri` redacts.
 */
function erasureLink(origin: string, token: string): string {
  return `${origin}${ROUTES.accountErasure.path()}?token=${encodeURIComponent(token)}`;
}

// The link opens on any browser: a signed-out one is led through the sign-in and back to it.
export function buildErasureEmail({ origin, token }: { origin: string; token: string }): Mail {
  // Normalised before the link is spelled, so a configured trailing slash reaches neither version.
  const site = mailOrigin(origin);

  return {
    kind: "security",
    subjectLine: COPY.page.accountErasure,
    origin: site,
    paragraphs: [[WORDS.lead], [[{ strong: WORDS.consequence }]], [SERVER_COPY.mail.linkValidFor(ERASURE_LINK_VALID_HOURS)]],
    button: { label: COPY.page.accountErasure, href: erasureLink(site, token) },
  };
}
