import "server-only";

import { SERVER_COPY } from "./serverCopy";
import { CODE_VALIDITY_MINUTES } from "./signInCode";

import type { Mail } from "./emailShell";

const WORDS = SERVER_COPY.mail.signInCode;

// No button: a link that carried the code would sign in whoever opened a forwarded message, and one
// without it opens a second `/signin` holding none of the step the reader is standing in.
export function buildCodeEmail(code: string, origin: string): Mail {
  return {
    audience: "signIn",
    subjectLine: WORDS.subject,
    origin,
    paragraphs: [[WORDS.lead]],
    block: { code },
    // The host a relay page cannot wear, read off the serving origin the code signs in on: a code typed into anything
    // but this site's own form is the one way it leaks.
    afterBlock: [[WORDS.validity(CODE_VALIDITY_MINUTES), WORDS.onlyHere(new URL(origin).host)]],
  };
}
