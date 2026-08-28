import "server-only";

import { KONTAKT_EMAIL, SITE_URL } from "./brand";

const BRAND_NAME = "Frankfurt-League";

/**
 * Future tense because it has to be: a club is entered only while its season is `future`
 * (`REQ-ENTER-001`), and `future` is the one status the public tier is refused
 * (`fl_backend/app/api/saisons/services.py :: WITHHELD_FROM_BASE_TIER`).
 */
const WEBSITE_SENTENCE = `Spielplan, Tabelle und Ergebnisse veröffentlichen wir auf ${SITE_URL}, sobald die Saison startet.`;

/**
 * Restated from `fl_frontend/src/core/authEmail.ts`, not imported: neither owns the other's chrome.
 * `fl_frontend/src/app/globals.css`'s light theme, hardcoded because email has no CSS variables and
 * fixed to light because the client picks the theme.
 */
const BRAND_COLOR = "#82181a";
const PAGE_COLOR = "#f5f5f5";
const CARD_COLOR = "#ffffff";
const TEXT_COLOR = "#525252";
const HEADING_COLOR = "#0a0a0a";
const RULE_COLOR = "#d4d4d4";

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BODY_TEXT = `font-size:15px;line-height:1.6;color:${TEXT_COLOR};`;

export type BewerbungEmail = { subject: string; html: string; text: string };

/**
 * What an accepted application is told. `gruppe` and `trikotFarbeLabel` arrive rendered because their
 * vocabularies live in `fl_frontend/src/features/teams/`, which `core` may not import
 * (`eslint.config.mjs :: LAYER_BOUNDARY`).
 */
export interface BewerbungZusageData {
  teamName: string;
  saisonId: string;
  gruppe: string;
  /** Absent while no kit colour has been assigned; the message then states that rather than guessing one. */
  trikotFarbeLabel: string | null;
}

/** What a declined application is told. `grund` is the administrator's own wording, carried verbatim. */
export interface BewerbungAbsageData {
  teamName: string;
  saisonId: string;
  grund: string;
}

/**
 * The HTML branch's only interpolation guard, and the app's only one. Neither value is trusted -- a
 * team name may be typed outside the league, a decline reason is an administrator's free text --
 * and each lands inside markup no framework is watching.
 */
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Escaped first, so the break markup this adds is the only markup in the value. A `TextArea` submits either newline. */
function escapeHtmlLines(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, "<br />");
}

/** A body paragraph in the sign-in mail's own grade. `margin` is the caller's because the stack's last one sets the button off. */
function paragraph(inner: string, margin = "0 0 16px"): string {
  return `<p style="margin:${margin};${BODY_TEXT}">
        ${inner}
      </p>`;
}

/** The emphasis grade `authEmail.ts` uses for the one fact a paragraph exists to carry. */
function strong(inner: string): string {
  return `<strong style="color:${HEADING_COLOR};">${inner}</strong>`;
}

/**
 * The card `authEmail.ts` draws, with its wordmark, heading, rule and closing note. `blocks` are
 * already-escaped markup: everything reaching this has passed `escapeHtml`, so the shell interpolates
 * without escaping and no value gets escaped twice.
 */
function renderShell(heading: string, blocks: readonly string[]): string {
  return `<!doctype html>
<html lang="de">
  <body style="margin:0;padding:24px;background-color:${PAGE_COLOR};font-family:${FONT_STACK};">
    <div style="max-width:480px;margin:0 auto;background-color:${CARD_COLOR};border-radius:12px;padding:32px;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${TEXT_COLOR};font-weight:700;">
        ${BRAND_NAME}
      </p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${HEADING_COLOR};font-weight:800;">
        ${heading}
      </h1>
      ${blocks.join("\n      ")}
      <a href="mailto:${KONTAKT_EMAIL}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:10px;">
        Frage stellen
      </a>
      <hr style="border:none;border-top:1px solid ${RULE_COLOR};margin:28px 0 16px;" />
      <p style="margin:0;font-size:12px;line-height:1.6;color:${TEXT_COLOR};">
        Diese E-Mail geht an die Kontaktpersonen der Bewerbung. Antworten an die Absenderadresse liest niemand.
        Schreibe uns an ${KONTAKT_EMAIL}.
      </p>
    </div>
  </body>
</html>`;
}

/** The closing line of the plain-text branch, matching the shell's rule and note. */
function textFooter(): readonly string[] {
  return [
    "",
    // RFC 3676 §4.3: the delimiter is "-- " with the trailing space, and without it no client folds
    // the footer as a signature.
    "-- ",
    "Diese E-Mail geht an die Kontaktpersonen der Bewerbung.",
    `Antworten an die Absenderadresse liest niemand. Schreibe uns an ${KONTAKT_EMAIL}.`,
  ];
}

/**
 * Stuffed rather than dropped: a client folding at the wrong delimiter hides every line below it.
 * RFC 3676 §4.4 space-stuffs a line it would misread the same way. Exported for its own test: both
 * bodies below close on fixed copy.
 */
export function stuffSignatureDelimiter(value: string): string {
  // Anchored on a preceding break: the body's first line is fixed copy, so no value begins the
  // message. The end-of-string alternative covers a body ENDING on a value, which a reordering of
  // the copy below would produce and neither message does today.
  return value.replace(/(\r\n|\r|\n)-- (?=\r|\n|$)/g, "$1 -- ");
}

/**
 * The text branch of one message: the body stuffed WHOLE, then the footer, whose delimiter is the
 * one a client may fold at. Per message rather than per value, so no field is left out of the guard.
 */
function renderText(body: readonly string[]): string {
  return [stuffSignatureDelimiter(body.join("\n")), ...textFooter()].join("\n");
}

/**
 * **The two parts state the same facts.** A mail client renders one or the other, so anything only the
 * text half carried would reach only the readers whose client refuses HTML.
 */
export function buildBewerbungZusageEmail({ teamName, saisonId, gruppe, trikotFarbeLabel }: BewerbungZusageData): BewerbungEmail {
  const farbeText =
    trikotFarbeLabel === null ? "Eine Trikotfarbe ist noch nicht festgelegt." : `Die Trikotfarbe des Teams ist ${trikotFarbeLabel}.`;

  const html = renderShell(`Zusage für die Saison ${escapeHtml(saisonId)}`, [
    paragraph(
      `${strong(escapeHtml(teamName))} ist für die Saison ${escapeHtml(saisonId)} der ${BRAND_NAME} aufgenommen. Wir freuen uns auf die gemeinsame Saison.`,
    ),
    paragraph(
      `Gespielt wird in ${strong(`Gruppe ${escapeHtml(gruppe)}`)}. ${trikotFarbeLabel === null ? farbeText : `Die Trikotfarbe des Teams ist ${strong(escapeHtml(trikotFarbeLabel))}.`}`,
    ),
    paragraph(WEBSITE_SENTENCE, "0 0 24px"),
  ]);

  const text = renderText([
    `${BRAND_NAME}: Zusage für die Saison ${saisonId}`,
    "",
    `${teamName} ist für die Saison ${saisonId} der ${BRAND_NAME} aufgenommen.`,
    "Wir freuen uns auf die gemeinsame Saison.",
    "",
    `Gespielt wird in Gruppe ${gruppe}.`,
    farbeText,
    "",
    WEBSITE_SENTENCE,
  ]);

  return { subject: `Zusage: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/**
 * **The two parts state the same facts**, as in the acceptance above. The message states the decision
 * and the reason it was given, and says that it covers this application rather than the school.
 */
export function buildBewerbungAbsageEmail({ teamName, saisonId, grund }: BewerbungAbsageData): BewerbungEmail {
  const html = renderShell(`Absage für die Saison ${escapeHtml(saisonId)}`, [
    paragraph(
      `Danke, dass ${strong(escapeHtml(teamName))} sich für die Saison ${escapeHtml(saisonId)} der ${BRAND_NAME} beworben hat. Für diese Saison können wir das Team nicht aufnehmen.`,
    ),
    // The reason stands in its own paragraph, unabridged: it is the one thing the message exists to
    // hand over, and a reader who skims the rest still needs to arrive at it.
    paragraph(`Angegebener Grund: ${escapeHtmlLines(grund)}`),
    paragraph("Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter.", "0 0 24px"),
  ]);

  const text = renderText([
    `${BRAND_NAME}: Absage für die Saison ${saisonId}`,
    "",
    `Danke, dass ${teamName} sich für die Saison ${saisonId} der ${BRAND_NAME} beworben hat.`,
    "Für diese Saison können wir das Team nicht aufnehmen.",
    "",
    `Angegebener Grund: ${grund}`,
    "",
    "Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter.",
  ]);

  return { subject: `Absage: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}
