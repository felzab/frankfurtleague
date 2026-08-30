import "server-only";

import { KONTAKT_EMAIL } from "./brand";

/** The league's name as every message spells it, in one place so no two messages can spell it apart. */
export const BRAND_NAME = "Frankfurt-League";

/**
 * `fl_frontend/src/app/globals.css`'s light theme, hardcoded because email has no CSS variables.
 * Light first: a client ignoring the dark query inverts dark grounds too, so a dark-first message
 * would come out light with dark-palette text.
 */
export const BRAND_COLOR = "#82181a";
/** `--accent-brand-solid`, the fill under a button label. It does not flip, so no dark rule may reach it. */
const BRAND_SOLID_COLOR = "#82181a";
export const SURFACE_COLOR = "#f5f5f5";
const CARD_COLOR = "#ffffff";
export const TEXT_COLOR = "#525252";
export const HEADING_COLOR = "#0a0a0a";
export const RULE_COLOR = "#d4d4d4";
/**
 * `--fg-on-brand`, the label on a brand fill. Equal to `CARD_COLOR` in this theme and NOT the same
 * token: the fill it sits on does not flip, so this must not follow the card into the dark palette.
 */
const ON_BRAND_COLOR = "#ffffff";

/**
 * `globals.css`'s `[data-theme="dark"]` block, token for token. `emailShell.test.ts` reads BOTH
 * palettes out of that file and compares them to these, so neither can drift from the site's.
 */
const DARK_SURFACE_COLOR = "#121212";
const DARK_CARD_COLOR = "#030303";
const DARK_TEXT_COLOR = "#a3a3a3";
const DARK_HEADING_COLOR = "#ffffff";
const DARK_RULE_COLOR = "#333333";
/** `--accent-brand`, lightened for a dark ground. The button fill is `BRAND_SOLID_COLOR`, which does not flip. */
const DARK_BRAND_COLOR = "#e05b5e";

/**
 * Hooks for the one stylesheet. An inline style outranks a rule, so every dark declaration carries
 * `!important` and every element it must reach carries one of these.
 */
const PAGE_CLASS = "fl-page";
const CARD_CLASS = "fl-card";
export const PANEL_CLASS = "fl-panel";
export const TEXT_CLASS = "fl-text";
export const HEAD_CLASS = "fl-head";
export const BRAND_CLASS = "fl-brand";
const RULE_CLASS = "fl-rule";
const GHOST_CLASS = "fl-ghost";

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BODY_TEXT = `font-size:15px;line-height:1.6;color:${TEXT_COLOR};`;
/** The aside grade the note above the controls is set in: still body copy, one step quieter. */
export const ASIDE_TEXT = `font-size:13px;line-height:1.6;color:${TEXT_COLOR};`;
/**
 * The value grade with its colour left open. Same size and line-height as the value beside it: two
 * grades in one row put their first baselines ~2px apart, which is what reads as a broken column.
 */
export const LABEL_TEXT = "font-size:15px;line-height:1.6;";
const FOOTER_TEXT = `font-size:12px;line-height:1.6;color:${TEXT_COLOR};`;

/**
 * Zeroed on every layout table: a screen reader announcing chrome as a data table is unusable, and
 * Outlook honours these attributes where it ignores the equivalent declarations.
 */
export const TABLE_ATTRS = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

/**
 * The card's width, stated twice because Outlook on Windows honours neither `max-width` nor a
 * `<div>`'s padding: without the conditional table below, the card reaches a school full width.
 */
const CARD_WIDTH = 480;

/**
 * `fl_frontend/src/shared/components/ui/formButtons.ts :: ctaButton` in email-safe terms: `h-12`,
 * `px-6`, `rounded-xl`, `font-bold` and `shadow-md` as fixed pixels, because no `<td>` honours a
 * utility class and Word computes no shorthand.
 */
const BUTTON_HEIGHT = 48;
/** `fluid-sm` clamps between 14 and 16px on viewport width, which a fixed-width card in an unknown window cannot express. */
const BUTTON_FONT = 15;
const BUTTON_LINE = 18;
const BUTTON_PAD_X = 24;
const BUTTON_RADIUS = 12;
const BUTTON_GAP = 12;
const BUTTON_SHADOW = "0 4px 6px -1px rgba(0,0,0,0.1),0 2px 4px -2px rgba(0,0,0,0.1)";
/**
 * `display:inline-block` is what makes the padded area clickable rather than the label alone. The
 * fill sits on the cell instead, because Outlook drops horizontal padding on an `<a>`.
 */
const BUTTON_TEXT = `display:inline-block;font-family:${FONT_STACK};font-size:${BUTTON_FONT}px;line-height:${BUTTON_LINE}px;font-weight:700;text-decoration:none;`;

/** The outline control's 1px border is part of the same 48px box, so its own padding gives that pixel back. */
function buttonPadding(umrandet: boolean): string {
  const rand = umrandet ? 1 : 0;

  return `${(BUTTON_HEIGHT - BUTTON_LINE) / 2 - rand}px ${BUTTON_PAD_X - rand}px`;
}

/**
 * The only rules not stated inline, and the only place a caller's value must never reach:
 * `escapeHtml` guards an HTML context and a stylesheet is not one. Built from constants alone, which
 * the test pins by rendering it identical for every input.
 */
const DARK_STYLE = `<style>
      @media (prefers-color-scheme: dark) {
        .${PAGE_CLASS} { background-color: ${DARK_SURFACE_COLOR} !important; }
        .${CARD_CLASS} { background-color: ${DARK_CARD_COLOR} !important; }
        .${PANEL_CLASS} { background-color: ${DARK_SURFACE_COLOR} !important; border-color: ${DARK_RULE_COLOR} !important; }
        .${TEXT_CLASS} { color: ${DARK_TEXT_COLOR} !important; }
        .${HEAD_CLASS} { color: ${DARK_HEADING_COLOR} !important; }
        .${BRAND_CLASS} { color: ${DARK_BRAND_COLOR} !important; }
        .${RULE_CLASS} { border-top-color: ${DARK_RULE_COLOR} !important; }
        .${GHOST_CLASS} { border-color: ${DARK_RULE_COLOR} !important; }
      }
      @media (max-width: ${CARD_WIDTH}px) {
        .fl-actions, .fl-actions tbody, .fl-actions tr, .fl-action, .fl-gap {
          display: block !important;
          width: 100% !important;
        }
      }
    </style>`;

/**
 * The HTML branch's only interpolation guard, and the app's only one. No value is trusted -- a team
 * name may be typed outside the league, a decline reason is an administrator's free text -- and each
 * lands inside markup no framework is watching.
 */
export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Escaped first, so the break markup this adds is the only markup in the value. A `TextArea` submits either newline. */
export function escapeHtmlLines(value: string): string {
  return escapeHtml(value).replace(/\r\n?|\n/g, "<br />");
}

/** A body paragraph. `margin` and `grade` are the caller's: the last one before the controls closes quieter. */
export function paragraph(inner: string, margin = "0 0 16px", grade = BODY_TEXT): string {
  return `<p class="${TEXT_CLASS}" style="margin:${margin};${grade}">${inner}</p>`;
}

/** The emphasis grade for the one fact a paragraph exists to carry. */
export function strong(inner: string): string {
  return `<strong class="${HEAD_CLASS}" style="color:${HEADING_COLOR};">${inner}</strong>`;
}

/** Underlined as well as coloured, because colour alone is not a link to a reader who cannot see it. */
export function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" class="${BRAND_CLASS}" style="color:${BRAND_COLOR};text-decoration:underline;">${escapeHtml(label)}</a>`;
}

/** The brand colour on the phrase a message turns on, wherever it stands. */
export function brandPhrase(inner: string): string {
  return `<strong class="${BRAND_CLASS}" style="color:${BRAND_COLOR};">${inner}</strong>`;
}

/** One no-reply sender carries every message (`fl_frontend/src/core/mail.ts :: MAIL_FROM`), so every close says so. */
const ANTWORT_VOR = "Antworten an die Absenderadresse liest niemand. Schreibe uns an ";
export const ANTWORT_SATZ_TEXT = `${ANTWORT_VOR}${KONTAKT_EMAIL}.`;
export const ANTWORT_SATZ_HTML = `${ANTWORT_VOR}${link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)}.`;

/** One control. `ton` picks the pair's two grades, which are the landing page's own primary and outline. */
export interface Aktion {
  readonly href: string;
  readonly label: string;
  readonly ton: "primary" | "outline";
}

/** Fill, radius and shadow ride on the cell; only the type and the padded hit area are the anchor's. */
function aktionZelle(aktion: Aktion): string {
  const umrandet = aktion.ton === "outline";
  const polster = `padding:${buttonPadding(umrandet)};`;

  /* The outline grade rests on the card rather than on a fill of its own, so it declares no
     background: `bg-transparent` is what `ctaButton` gives it, and a declared one would need a
     second dark rule to follow the card. */
  if (umrandet) {
    return `<td align="center" class="fl-action ${GHOST_CLASS}" style="border:1px solid ${RULE_COLOR};border-radius:${BUTTON_RADIUS}px;">
                      <a href="${escapeHtml(aktion.href)}" class="${HEAD_CLASS}" style="${BUTTON_TEXT}${polster}color:${HEADING_COLOR};">${escapeHtml(aktion.label)}</a>
                    </td>`;
  }

  return `<td align="center" class="fl-action" style="background-color:${BRAND_SOLID_COLOR};border-radius:${BUTTON_RADIUS}px;box-shadow:${BUTTON_SHADOW};">
                      <a href="${escapeHtml(aktion.href)}" style="${BUTTON_TEXT}${polster}color:${ON_BRAND_COLOR};">${escapeHtml(aktion.label)}</a>
                    </td>`;
}

/**
 * The controls in one row, since Outlook has no flexbox. The stylesheet turns the cells into blocks
 * below the card's width, which is where a row of two stops fitting.
 */
function renderAktionen(aktionen: readonly Aktion[]): string {
  const abstand = `<td class="fl-gap" width="${BUTTON_GAP}" style="width:${BUTTON_GAP}px;height:${BUTTON_GAP}px;line-height:${BUTTON_GAP}px;font-size:${BUTTON_GAP}px;">&nbsp;</td>`;

  return `<table ${TABLE_ATTRS} align="center" class="fl-actions" style="margin:0 auto;">
                  <tr>
                    ${aktionen.map(aktionZelle).join(`\n                    ${abstand}\n                    `)}
                  </tr>
                </table>`;
}

/** One message as the shell draws it. Every markup field arrives escaped; `titel` is the one plain string. */
interface Karte {
  readonly titel: string;
  readonly ueberschrift: string;
  readonly bloecke: readonly string[];
  readonly aktionen: readonly Aktion[];
  readonly fuss: string;
}

/**
 * The card every message is drawn in, in tables. `bloecke`, `ueberschrift` and `fuss` are already-escaped
 * markup: everything reaching this has passed `escapeHtml`, so the shell interpolates without escaping
 * and no value gets escaped twice.
 */
export function renderKarte({ titel, ueberschrift, bloecke, aktionen, fuss }: Karte): string {
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>${escapeHtml(titel)}</title>
    ${DARK_STYLE}
  </head>
  <body class="${PAGE_CLASS}" style="margin:0;padding:0;background-color:${SURFACE_COLOR};">
    <table ${TABLE_ATTRS} width="100%" class="${PAGE_CLASS}" style="background-color:${SURFACE_COLOR};">
      <tr>
        <td align="center" style="padding:24px 12px;font-family:${FONT_STACK};">
          <!--[if mso]><table ${TABLE_ATTRS} width="${CARD_WIDTH}" align="center"><tr><td><![endif]-->
          <table ${TABLE_ATTRS} width="100%" align="center" lang="de" class="${CARD_CLASS}" style="max-width:${CARD_WIDTH}px;margin:0 auto;background-color:${CARD_COLOR};border-radius:12px;">
            <tr>
              <td style="padding:32px;font-family:${FONT_STACK};">
                <p class="${TEXT_CLASS}" style="margin:0 0 8px;${FOOTER_TEXT}letter-spacing:1px;text-transform:uppercase;font-weight:700;">${BRAND_NAME}</p>
                <h1 class="${HEAD_CLASS}" style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${HEADING_COLOR};font-weight:800;">
                  ${ueberschrift}
                </h1>
                ${bloecke.join("\n                ")}
                <hr class="${RULE_CLASS}" style="border:none;border-top:1px solid ${RULE_COLOR};margin:24px 0;" />
                ${renderAktionen(aktionen)}
                <hr class="${RULE_CLASS}" style="border:none;border-top:1px solid ${RULE_COLOR};margin:24px 0 16px;" />
                <p class="${TEXT_CLASS}" style="margin:0;${FOOTER_TEXT}">
                  ${fuss}
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Stuffed rather than dropped: a client folding at the wrong delimiter hides every line below it.
 * RFC 3676 §4.4 space-stuffs a line it would misread the same way. Exported for its own test:
 * every message's body closes on fixed copy.
 */
export function stuffSignatureDelimiter(value: string): string {
  // Anchored on a preceding break: a body's first line is fixed copy, so no value begins a message.
  // The end-of-string alternative covers a body ENDING on a value, which a reordering of the copy
  // would produce and no message does today.
  return value.replace(/(\r\n|\r|\n)-- (?=\r|\n|$)/g, "$1 -- ");
}

/** The plain-text close, matching the card's rule and note. RFC 3676 §4.3: without the trailing space no client folds it. */
export function textFooter(saetze: readonly string[]): readonly string[] {
  return ["", "-- ", ...saetze];
}
