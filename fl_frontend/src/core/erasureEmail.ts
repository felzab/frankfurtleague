import "server-only";

import { COPY } from "./copy/shared";
import { mailedLinkTo, ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";

/**
 * The one figure the sign-in library expires the deletion link on and this message states.
 */
export const ERASURE_LINK_VALID_HOURS = 24;

const WORDS = SERVER_COPY.mail.erasureLink;

// The link opens on any browser: a signed-out one is led through the sign-in and back to it.
export function buildErasureEmail({ origin, token }: { origin: string; token: string }): Mail {
  return {
    audience: "security",
    subjectLine: COPY.page.accountErasure,
    origin,
    paragraphs: [[WORDS.lead], [[{ strong: WORDS.consequence }]], [SERVER_COPY.mail.linkValidFor(ERASURE_LINK_VALID_HOURS)]],
    // From the token alone, never the sign-in library's own `url`, which deletes on a GET.
    button: { label: COPY.page.accountErasure, href: mailedLinkTo(origin, ROUTES.accountErasure, token) },
  };
}
