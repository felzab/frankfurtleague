import "server-only";

import { mailOrigin } from "./emailShell";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth/library.ts` expires the code on it and this message states it.
 * It lives HERE because the import the other way round would read it inside its own dead zone.
 */
export const CODE_VALIDITY_MINUTES = 10;

const WORDS = SERVER_COPY.mail.signInCode;

// No button: a link that carried the code would sign in whoever opened a forwarded message, and one
// without it opens a second `/signin` holding none of the step the reader is standing in.
export function buildCodeEmail(code: string, origin: string): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "signIn",
    subjectLine: WORDS.subject,
    origin: site,
    vorname: "",
    paragraphs: [[WORDS.lead]],
    block: { code: code },
    // The host a relay page cannot wear, read off the serving origin the code signs in on: a code typed into anything
    // but this site's own form is the one way it leaks.
    afterBlock: [
      [WORDS.validity(CODE_VALIDITY_MINUTES), [`${WORDS.onlyHere.before} `, { strong: new URL(site).host }, ` ${WORDS.onlyHere.after}`]],
    ],
  };
}
