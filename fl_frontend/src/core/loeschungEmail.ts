import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";

import type { Mail } from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth.ts` expires the deletion link on it and this message
 * states it, as `fl_frontend/src/core/authEmail.ts :: CODE_VALIDITY_MINUTES` is shared.
 */
export const LOESCHUNG_LINK_GUELTIG_STUNDEN = 24;

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

export function buildLoeschungEmail({ origin, token }: { origin: string; token: string }): Mail {
  // Normalised before the link is spelled, so a configured trailing slash reaches neither version.
  const site = mailOrigin(origin);

  return {
    art: "sicherheit",
    betreff: "Konto löschen",
    origin: site,
    vorname: "",
    absaetze: [
      [`Du hast angefordert, Dein Konto bei der ${BRAND_NAME} zu löschen.`, "Über den Link unten bestätigst Du das."],
      [
        [
          {
            stark:
              "Dabei löschen wir Dein Konto und alle Angaben, die wir unter Deiner E-Mail-Adresse gespeichert haben. Zurückholen lässt sich das nicht.",
          },
        ],
      ],
      // The link completes nothing for a browser holding no session: said before the press, so a reader
      // opening it on another device is not surprised by the sign-in it asks for.
      [`Der Link gilt ${String(LOESCHUNG_LINK_GUELTIG_STUNDEN)} Stunden.`, "Öffne ihn in dem Browser, in dem Du angemeldet bist."],
    ],
    aktion: { label: "Zur Löschung", href: loeschungsLink(site, token) },
  };
}
