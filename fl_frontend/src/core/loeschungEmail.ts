import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth/library.ts` expires the deletion link on it and this message
 * states it, as `fl_frontend/src/core/authEmail.ts :: CODE_VALIDITY_MINUTES` is shared.
 */
export const ERASURE_LINK_VALID_HOURS = 24;

const WORDS = SERVER_COPY.mail.erasureLink;

/**
 * The one place the deletion link is spelled, from the token alone and never the library's own `url`,
 * which deletes on a GET. `token` is the name
 * `nginx/shared/http.conf :: $credential_free_uri` redacts.
 */
function erasureLink(origin: string, token: string): string {
  return `${origin}${ROUTES.accountErasure.path()}?token=${encodeURIComponent(token)}`;
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
    paragraphs: [[WORDS.lead], [[{ strong: WORDS.consequence }]], [SERVER_COPY.mail.linkValidFor(ERASURE_LINK_VALID_HOURS)]],
    button: { label: COPY.page.accountErasure, href: erasureLink(site, token) },
  };
}
