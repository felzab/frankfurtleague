import "server-only";

import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  escapeHtml,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

/**
 * The one figure: `fl_frontend/src/core/auth.ts` expires the code on it and this message states it.
 * It lives HERE because the import the other way round would read it inside its own dead zone.
 */
export const CODE_VALIDITY_MINUTES = 10;

const UEBERSCHRIFT = "Dein Anmeldecode";

const EINGABE_SATZ = "Gib diesen Code auf der Anmeldeseite ein:";

const GUELTIG_SATZ = `Er ist ${String(CODE_VALIDITY_MINUTES)} Minuten gültig und kann nur einmal verwendet werden.`;

/** The phishing warning: a code typed into anything but this site's own form is the one way it leaks. */
const NUR_HIER_SATZ = "Gib ihn nur auf unserer Seite ein. Wir fragen Dich nie auf anderem Weg nach diesem Code.";

/**
 * An address typed into a public sign-in page reaches whoever it was typed for. Last in the body and
 * out of the grey close, where `fl_frontend/src/core/bewerbungEmail.ts :: IGNORIER_SATZ` stands.
 */
const IGNORIER_SATZ = "Du hast keinen Code angefordert? Dann ignoriere diese E-Mail einfach. Ohne den Code passiert nichts.";

/** Wide-set and large, so six digits read off a phone beside the laptop they are typed into. */
const CODE_GRADE = "font-size:32px;line-height:1.2;letter-spacing:8px;font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace;";

export type CodeEmail = { subject: string; html: string; text: string };

function renderHtml(code: string, origin: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(EINGABE_SATZ, "0 0 12px"),
      paragraph(strong(escapeHtml(code)), "0 0 16px", CODE_GRADE),
      paragraph(GUELTIG_SATZ),
      paragraph(NUR_HIER_SATZ, "0 0 16px", ASIDE_TEXT),
      paragraph(IGNORIER_SATZ, "0", ASIDE_TEXT),
    ],
    // No control: a link that carried the code would sign in whoever opened a forwarded message, and
    // one without it opens a second `/signin` holding none of the step the reader is standing in.
    aktionen: [],
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });
}

function renderText(code: string, origin: string): string {
  const oben = [`${BRAND_NAME}: ${UEBERSCHRIFT}`, "", EINGABE_SATZ, "", code, "", GUELTIG_SATZ, "", NUR_HIER_SATZ, "", IGNORIER_SATZ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`).
 */
export function buildCodeEmail(code: string, origin: string): CodeEmail {
  const site = mailOrigin(origin);

  return {
    subject: `Dein Anmeldecode für die ${BRAND_NAME}`,
    html: renderHtml(code, site),
    text: renderText(code, site),
  };
}
