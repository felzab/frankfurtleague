import "server-only";

import { mailOrigin } from "./emailShell";

import type { Mail, Satz } from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth.ts` expires the code on it and this message states it.
 * It lives HERE because the import the other way round would read it inside its own dead zone.
 */
export const CODE_VALIDITY_MINUTES = 10;

/**
 * The phishing warning: a code typed into anything but this site's own form is the one way it leaks, so
 * it names the host a relay page cannot wear, read off the serving origin the code signs in on.
 */
function nurHierSatz(site: string): readonly [Satz, Satz] {
  return [["Gib ihn nur auf ", { stark: new URL(site).host }, " ein."], "Wir fragen Dich nie auf anderem Weg nach diesem Code."];
}

// No button: a link that carried the code would sign in whoever opened a forwarded message, and one
// without it opens a second `/signin` holding none of the step the reader is standing in.
export function buildCodeEmail(code: string, origin: string): Mail {
  const site = mailOrigin(origin);

  return {
    art: "anmeldung",
    betreff: "Dein Anmeldecode",
    origin: site,
    vorname: "",
    // One sentence for both pages that send it: the sign-in page's code step and the account page's confirmation.
    absaetze: [["Gib diesen Code auf der Seite ein, auf der Du ihn angefordert hast:"]],
    block: { code: code },
    nachBlock: [[`Er ist ${String(CODE_VALIDITY_MINUTES)} Minuten gültig und kann nur einmal verwendet werden.`], nurHierSatz(site)],
  };
}
