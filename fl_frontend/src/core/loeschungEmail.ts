import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth/library.ts` expires the deletion link on it and this message
 * states it, as `fl_frontend/src/core/authEmail.ts :: CODE_VALIDITY_MINUTES` is shared.
 */
export const LOESCHUNG_LINK_GUELTIG_STUNDEN = 24;

const WORDS = SERVER_COPY.mail.erasureLink;

/** A segment of its own, which `fl_frontend/src/app/robots.ts` disallows and the sitemap's withheld list names. */
const LOESCHUNG_PATH = "/loeschung";

/**
 * The one place the deletion link is spelled, from the token alone and never the library's own `url`,
 * which deletes on a GET. `token` is the name
 * `nginx/shared/http.conf :: $credential_free_uri` redacts.
 */
function loeschungsLink(origin: string, token: string): string {
  return `${origin}${LOESCHUNG_PATH}?token=${encodeURIComponent(token)}`;
}

// The link opens on any browser: a signed-out one is led through the sign-in and back to it
// (`fl_frontend/src/core/auth/returnAddress.ts`).
export function buildLoeschungEmail({ origin, token }: { origin: string; token: string }): Mail {
  // Normalised before the link is spelled, so a configured trailing slash reaches neither version.
  const site = mailOrigin(origin);

  return {
    kind: "security",
    subjectLine: COPY.page.accountErasure,
    origin: site,
    vorname: "",
    paragraphs: [[WORDS.lead], [[{ strong: WORDS.consequence }]], [SERVER_COPY.mail.linkValidFor(LOESCHUNG_LINK_GUELTIG_STUNDEN)]],
    button: { label: COPY.page.accountErasure, href: loeschungsLink(site, token) },
  };
}
