import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";

import type { Mail } from "./emailShell";

/** A segment of its own rather than a query on a shared page, so the sitemap and `robots.ts` answer it by name. */
const SCHIEDSRICHTER_BESTAETIGUNG_PATH = "/bestaetigung/schiedsrichter";

/**
 * The one place the referee's confirmation link is spelled. `token` is the parameter name because
 * `nginx/shared/http.conf :: $credential_free_uri` matches that name; a second spelling reaches the access
 * line and the referer unredacted.
 */
export function schiedsrichterBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${SCHIEDSRICHTER_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}

// No name: an administrator typed this address and nobody has confirmed it, so behind a typo its
// reader is a stranger, owed none.
/** What one referee is asked to confirm. No season: a referee's entry is bound to none, so the deadline is the only date here. */
export interface SchiedsrichterBestaetigungData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  origin: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  /**
   * The deadline as a German date, rendered by the caller:
   * `fl_frontend/src/shared/utils/format.ts :: formatSpielDatum` sits in a layer `core` may not reach.
   */
  fristText: string;
}

export function buildSchiedsrichterBestaetigungEmail({ origin, token, fristText }: SchiedsrichterBestaetigungData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "erstkontakt",
    betreff: "Dein Eintrag als Schiedsrichterin oder Schiedsrichter",
    origin: site,
    vorname: "",
    absaetze: [
      [
        `Die Verwaltung der ${BRAND_NAME} hat Dich als Schiedsrichterin oder Schiedsrichter eingetragen.`,
        [
          { stark: "Bitte bestätige, dass das stimmt" },
          ": Erst danach kannst Du auf der Website Ansetzungen annehmen und Spielberichte einreichen.",
        ],
      ],
      // Both answers are named before the press: a reader who came to confirm an entry and meets a
      // publication choice was asked something the message did not say.
      [
        "Auf der Seite trägst Du Dein Geburtsdatum ein und entscheidest, was im Spielplan von Deinem Namen zu sehen ist.",
        ["Der Link ist bis zum ", { stark: fristText }, " gültig und funktioniert nur einmal."],
        "Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen.",
      ],
    ],
    aktion: { label: "Eintrag bestätigen", href: schiedsrichterBestaetigungsLink(site, token) },
  };
}
