import "server-only";

import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  escapeHtml,
  link,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

/** Copy only. The real TTL is the Resend `maxAge` in `fl_frontend/src/core/auth.ts` — change both. */
const LINK_VALIDITY_TEXT = "15 Minuten";

const UEBERSCHRIFT = "Anmeldung bestätigen";

/**
 * An address typed into a public sign-in page reaches whoever it was typed for. Above the control
 * and out of the grey close, where `fl_frontend/src/core/bewerbungEmail.ts :: IGNORIER_SATZ` stands.
 */
const IGNORIER_SATZ = "Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach. Ohne den Link passiert nichts.";

const FALLBACK_SATZ = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";

export type MagicLinkEmail = { subject: string; html: string; text: string };

/**
 * One control, where the three application messages carry a pair: the message exists for this link
 * alone, and a second destination beside it competes with the one press a reader came for.
 */
function aktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Jetzt anmelden", ton: "primary" }];
}

function renderHtml(url: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(
        `Klicke auf den Button, um Dich bei der ${BRAND_NAME}-Verwaltung anzumelden. Der Link ist ${strong(LINK_VALIDITY_TEXT)} gültig und kann nur einmal verwendet werden. Ist er abgelaufen, fordere auf der Anmeldeseite einfach einen neuen an.`,
      ),
      paragraph(FALLBACK_SATZ, "0 0 8px", ASIDE_TEXT),
      /* The signed URL runs past the card's width, so this one paragraph breaks inside a word.
         Marked as a link as well: an address a reader has to select and paste is not a route. */
      paragraph(link(url, url), "0 0 16px", `${ASIDE_TEXT}word-break:break-all;`),
      paragraph(IGNORIER_SATZ, "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(url),
    fuss: ANTWORT_SATZ_HTML,
  });
}

function renderText(url: string): string {
  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    "",
    `Öffne diesen Link, um Dich bei der ${BRAND_NAME}-Verwaltung anzumelden.`,
    `Er ist ${LINK_VALIDITY_TEXT} gültig und kann nur einmal verwendet werden.`,
    "",
    "Ist er abgelaufen, fordere auf der Anmeldeseite einfach einen neuen an.",
    "",
    url,
    "",
    IGNORIER_SATZ,
  ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter([ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts.** A mail client renders one or the other, so anything only
 * the text half carried would reach only the readers whose client refuses HTML.
 */
export function buildMagicLinkEmail(url: string): MagicLinkEmail {
  return {
    subject: `Anmeldelink für ${BRAND_NAME}`,
    html: renderHtml(url),
    text: renderText(url),
  };
}
