import "server-only";

import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  escapeHtml,
  FALLBACK_SATZ,
  fallbackBloecke,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth.ts` expires the deletion link on it and this message
 * states it, as `fl_frontend/src/core/authEmail.ts :: CODE_VALIDITY_MINUTES` is shared.
 */
export const LOESCHUNG_LINK_GUELTIG_STUNDEN = 24;

/** A segment of its own, so `fl_frontend/src/app/robots.ts` and the sitemap's withheld list answer it by name. */
export const LOESCHUNG_PATH = "/loeschung";

/**
 * The one place the deletion link is spelled, from the token alone and never the library's own `url`,
 * which deletes on a GET (`docs/frontend/spec.md :: I674`). `token` is the name
 * `nginx/shared/http.conf :: $credential_free_uri` redacts.
 */
export function loeschungsLink(origin: string, token: string): string {
  return `${origin}${LOESCHUNG_PATH}?token=${encodeURIComponent(token)}`;
}

const UEBERSCHRIFT = "Konto löschen";

const ANGEFORDERT_SATZ = `Du hast angefordert, Dein Konto bei der ${BRAND_NAME} zu löschen. Über den Link unten bestätigst Du das.`;

const FOLGE_SATZ =
  "Dabei löschen wir Dein Konto und alle Angaben, die wir unter Deiner E-Mail-Adresse gespeichert haben. Zurückholen lässt sich das nicht.";

// The link completes nothing for a browser holding no session: said before the press, so a reader
// opening it on another device is not surprised by the sign-in it asks for.
const GUELTIG_SATZ = `Der Link gilt ${String(LOESCHUNG_LINK_GUELTIG_STUNDEN)} Stunden. Öffne ihn in dem Browser, in dem Du angemeldet bist.`;

/** Only a session of this account can request the link, so a request the reader did not make is somebody else's session. */
const WARNSATZ = "Warst Du das nicht? Dann bestätige nichts und melde Dich sofort bei uns.";

export type LoeschungEmail = { subject: string; html: string; text: string };

/** One control, as the code's message carries none and the confirmation links carry one: the message exists for this link alone. */
function aktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Zur Löschung", ton: "primary" }];
}

function renderHtml(url: string, origin: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(ANGEFORDERT_SATZ),
      paragraph(strong(escapeHtml(FOLGE_SATZ))),
      paragraph(escapeHtml(GUELTIG_SATZ)),
      ...fallbackBloecke([{ label: "", url: url }], FALLBACK_SATZ),
      paragraph(WARNSATZ, "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(url),
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });
}

function renderText(url: string, origin: string): string {
  const oben = [`${BRAND_NAME}: ${UEBERSCHRIFT}`, "", ANGEFORDERT_SATZ, "", url, "", FOLGE_SATZ, "", GUELTIG_SATZ, "", WARNSATZ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`).
 */
export function buildLoeschungEmail({ origin, token }: { origin: string; token: string }): LoeschungEmail {
  // Normalised before the link is spelled, so a configured trailing slash reaches neither half.
  const site = mailOrigin(origin);
  const url = loeschungsLink(site, token);

  return {
    subject: `Löschung Deines Kontos bei der ${BRAND_NAME}`,
    html: renderHtml(url, site),
    text: renderText(url, site),
  };
}
