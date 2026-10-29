import "server-only";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } from "./brand";
import { COPY } from "./copy";

/** The league's name as every message spells it. */
export const BRAND_NAME: string = COPY.marke.name;

/**
 * What a mail is, which decides its sender, its „Nicht du?“ line and its Art. 21 line, so no caller can
 * pair them apart: a sign-in code, a change to what signs in, the first word to an address somebody
 * else typed, or anything else.
 */
type MailArt = "anmeldung" | "sicherheit" | "erstkontakt" | "mitteilung";

/** The two sending addresses (`fl_frontend/src/core/mail.ts :: ABSENDER`). */
export type MailVon = "anmeldung" | "liga";

const VON: Readonly<Record<MailArt, MailVon>> = { anmeldung: "anmeldung", sicherheit: "anmeldung", erstkontakt: "liga", mitteilung: "liga" };

/**
 * One run of a sentence. Every run is folded to one line and escaped by the shell alone, so a value typed
 * outside the league reaches neither version as markup or as a line of its own.
 */
export type Lauf = string | { readonly stark: string } | { readonly adresse: string } | { readonly url: string };

/** One sentence, a plain string or its runs. */
export type Satz = string | readonly Lauf[];

/** One paragraph, its sentences in order. The first sentence of the first paragraph is the mail's hidden preview. */
export type Absatz = readonly [Satz, ...Satz[]];

/** One row of the facts block. A value keeps its line breaks: a stated reason is a paragraph. */
export interface Fakt {
  readonly label: string;
  readonly wert: string;
}

/** The one button, its link printed below it. */
interface Knopf {
  readonly label: string;
  readonly href: string;
}

/** A link printed under the name it answers for, where one mail carries several and so no button. */
interface BenannterLink {
  readonly name: string;
  readonly href: string;
}

/** One mail as its template states it: data only, which `renderMail` turns into both versions. */
export interface Mail {
  readonly art: MailArt;
  /** The subject, topic first, which the heading repeats. */
  readonly betreff: string;
  /** Already through `mailOrigin`: the footer's links and the logo stand on it. */
  readonly origin: string;
  /** `""` where the first name is unknown, and the greeting then names nobody. */
  readonly vorname: string;
  readonly absaetze: readonly [Absatz, ...Absatz[]];
  /** The one facts block, a column of rows or the sign-in code. */
  readonly block?: { readonly fakten: readonly Fakt[] } | { readonly code: string };
  readonly nachBlock?: readonly Absatz[];
  readonly aktion?: Knopf | { readonly links: readonly BenannterLink[] };
}

/** What a mail is handed to the mailer as. */
export interface GerenderteMail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly von: MailVon;
}

// The 2027 scheme's light palette: one light design, in colours that still read where a mail app darkens it.
const BRAND_COLOR = "#216c2d";
const BRAND_SOLID_COLOR = "#033f11";
const SURFACE_COLOR = "#f5f5f5";
const CARD_COLOR = "#ffffff";
const TEXT_COLOR = "#525252";
const MUTED_COLOR = "#737373";
const HEADING_COLOR = "#0a0a0a";
const RULE_COLOR = "#d4d4d4";
const ON_BRAND_COLOR = "#ffffff";

const FONT_STACK = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BODY_TEXT = `font-size:16px;line-height:24px;color:${TEXT_COLOR};`;
const SMALL_TEXT = `font-size:14px;line-height:20px;color:${TEXT_COLOR};`;
const FOOTER_TEXT = `font-size:12px;line-height:16px;color:${TEXT_COLOR};`;
const MUTED_TEXT = `font-size:12px;line-height:16px;color:${MUTED_COLOR};`;

/** "Takt 24": every gap of the shell, in pixels. */
const ABSTAND = {
  karte: 32,
  karteTelefon: 24,
  logoKopf: 12,
  kopfText: 16,
  absatz: 12,
  block: 24,
  faktenInnen: 16,
  vorLinie: 32,
  nachLinie: 16,
  fusszeile: 4,
} as const;

/**
 * The card's width, stated twice because Outlook on Windows honours neither `max-width` nor a
 * `<div>`'s padding: without the conditional table, the card reaches full width.
 */
const CARD_WIDTH = 480;

// Session 2: the mail board's O12 drawing names this file and its width; nothing serves it yet.
const LOGO = { pfad: "/mail/logo.png", hoehe: 28 } as const;

/**
 * Zeroed on every layout table: a screen reader announcing chrome as a data table is unusable, and
 * Outlook honours these attributes where it ignores the equivalent declarations.
 */
const TABLE_ATTRS = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;

/**
 * The phone's padding and the full-width button, the one thing inline styles cannot state. Built from
 * constants alone: `escapeHtml` guards an HTML context, and a stylesheet is not one.
 */
const TELEFON_STYLE = `<style>
      @media (max-width: ${CARD_WIDTH}px) {
        .fl-pad { padding: ${ABSTAND.karteTelefon}px !important; }
        .fl-knopf, .fl-knopf td { width: 100% !important; }
        .fl-knopf a { display: block !important; }
      }
    </style>`;

/** The one interpolation guard: no value is trusted, and each lands inside markup no framework is watching. */
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** One line, whatever was typed: a value carrying a break would render a line the reader cannot tell from the mail's own. */
function einzeilig(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/**
 * The serving origin, refused rather than defaulted: `SKIP_ENV_VALIDATION` lets a build past
 * `config.ts`'s gate, and a message composed there would carry a bare path.
 */
export function mailOrigin(raw: string): string {
  try {
    // Through `URL` rather than used as typed: a configured trailing slash or path would otherwise reach every href.
    return new URL(raw).origin;
  } catch {
    throw new Error("a message's links need an absolute origin, and the one handed to the shell is not a URL");
  }
}

function laeufe(satz: Satz): readonly Lauf[] {
  return typeof satz === "string" ? [satz] : satz;
}

function laufText(lauf: Lauf): string {
  if (typeof lauf === "string") return einzeilig(lauf);
  if ("stark" in lauf) return einzeilig(lauf.stark);

  return einzeilig("adresse" in lauf ? lauf.adresse : lauf.url);
}

/** Underlined as well as coloured, because colour alone is not a link to a reader who cannot see it. */
function linkHtml(href: string, label: string, extra = ""): string {
  return `<a href="${escapeHtml(einzeilig(href))}" style="color:${BRAND_COLOR};text-decoration:underline;${extra}">${escapeHtml(einzeilig(label))}</a>`;
}

function laufHtml(lauf: Lauf): string {
  if (typeof lauf === "string") return escapeHtml(einzeilig(lauf));
  if ("stark" in lauf) return `<strong style="color:${HEADING_COLOR};">${escapeHtml(einzeilig(lauf.stark))}</strong>`;
  if ("adresse" in lauf) return linkHtml(`mailto:${lauf.adresse}`, lauf.adresse);

  return linkHtml(lauf.url, lauf.url, "word-break:break-all;");
}

const satzText = (satz: Satz): string => laeufe(satz).map(laufText).join("");
const absatzText = (absatz: Absatz): string => absatz.map(satzText).join(" ");
const absatzHtml = (absatz: Absatz): string => absatz.map((satz) => laeufe(satz).map(laufHtml).join("")).join(" ");

/** A fact's value as lines, every line after the first indented so none of them begins where a label does. */
const wertText = (wert: string): string => wert.replace(/\r\n|\r|\n/g, "\n  ");
const wertHtml = (wert: string): string => escapeHtml(wert).replace(/\r\n?|\n/g, "<br />");

/** The mail's hidden preview: the first sentence of its first paragraph. */
function vorschauVon(mail: Mail): string {
  return satzText(mail.absaetze[0][0]);
}

/** The Art. 21 line on a first contact, the address in it marked as a link. */
function widerspruchHtml(): string {
  return escapeHtml(COPY.mail.widerspruch).replace(escapeHtml(KONTAKT_EMAIL), linkHtml(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL));
}

function nichtDu(art: MailArt): string | undefined {
  return art === "mitteilung" ? undefined : COPY.mail.nichtDu[art];
}

/** One block of the card and the gap under it; the last block of the card takes none. */
type Baustein = { readonly html: string; readonly abstand: number };

const p = (inner: string, grade = BODY_TEXT): string => `<p style="margin:0;${grade}">${inner}</p>`;

/** The paragraphs of one group, a paragraph's gap between them and a block's gap after the last. */
function absatzBausteine(absaetze: readonly Absatz[]): Baustein[] {
  return absaetze.map((absatz, index) => ({
    html: p(absatzHtml(absatz)),
    abstand: index === absaetze.length - 1 ? ABSTAND.block : ABSTAND.absatz,
  }));
}

function blockHtml(block: NonNullable<Mail["block"]>): Baustein {
  const kasten = `background-color:${SURFACE_COLOR};border:1px solid ${RULE_COLOR};border-radius:8px;`;

  if ("code" in block) {
    return {
      html: `<table ${TABLE_ATTRS} width="100%" style="${kasten}"><tr><td align="center" style="padding:${ABSTAND.faktenInnen}px;font-family:${FONT_STACK};font-size:32px;line-height:40px;letter-spacing:6px;font-weight:700;color:${HEADING_COLOR};">${escapeHtml(einzeilig(block.code))}</td></tr></table>`,
      abstand: ABSTAND.kopfText,
    };
  }

  const zeilen = block.fakten
    .map(
      ({ label, wert }) =>
        `<tr><td style="padding:4px 16px 4px 0;font-family:${FONT_STACK};${SMALL_TEXT}white-space:nowrap;vertical-align:top;">${escapeHtml(einzeilig(label))}</td><td style="padding:4px 0;font-family:${FONT_STACK};font-size:14px;line-height:20px;color:${HEADING_COLOR};vertical-align:top;">${wertHtml(wert)}</td></tr>`,
    )
    .join("");

  return {
    html: `<table ${TABLE_ATTRS} width="100%" style="${kasten}"><tr><td style="padding:${ABSTAND.faktenInnen - 4}px ${ABSTAND.faktenInnen}px;"><table ${TABLE_ATTRS}>${zeilen}</table></td></tr></table>`,
    abstand: ABSTAND.block,
  };
}

/** The button, 44 px high (11 + 22 + 11) and full width on a phone, then its link printed to copy. */
function aktionBausteine(aktion: NonNullable<Mail["aktion"]>): Baustein[] {
  if ("links" in aktion) {
    return aktion.links.map(({ name, href }, index) => ({
      html: p(`${escapeHtml(einzeilig(name))}:<br />${linkHtml(href, href, "word-break:break-all;")}`, SMALL_TEXT),
      abstand: index === aktion.links.length - 1 ? ABSTAND.block : ABSTAND.absatz,
    }));
  }

  return [
    {
      html: `<table ${TABLE_ATTRS} class="fl-knopf" align="center" style="margin:0 auto;"><tr><td align="center" style="background-color:${BRAND_SOLID_COLOR};border-radius:8px;"><a href="${escapeHtml(einzeilig(aktion.href))}" style="display:inline-block;padding:11px 24px;font-family:${FONT_STACK};font-size:16px;line-height:22px;font-weight:700;color:${ON_BRAND_COLOR};text-decoration:none;">${escapeHtml(einzeilig(aktion.label))}</a></td></tr></table>`,
      abstand: ABSTAND.absatz,
    },
    {
      html: p(`${escapeHtml(COPY.mail.knopfLink)}<br />${linkHtml(aktion.href, aktion.href, "word-break:break-all;")}`, SMALL_TEXT),
      abstand: ABSTAND.block,
    },
  ];
}

function rechtsLinks(origin: string): readonly { readonly label: string; readonly href: string }[] {
  return [
    { label: COPY.seite.datenschutz, href: `${origin}/datenschutz` },
    { label: COPY.seite.impressum, href: `${origin}/impressum` },
  ];
}

const VEREIN_ZEILE = `${VEREIN_NAME} · ${VEREIN_ANSCHRIFT}`;

function renderHtml(mail: Mail, betreff: string): string {
  const inhalt: Baustein[] = [
    {
      html: `<img src="${escapeHtml(`${mail.origin}${LOGO.pfad}`)}" height="${String(LOGO.hoehe)}" alt="${escapeHtml(BRAND_NAME)}" style="display:block;height:${String(LOGO.hoehe)}px;border:0;outline:none;text-decoration:none;" />`,
      abstand: ABSTAND.logoKopf,
    },
    {
      html: `<h1 style="margin:0;font-size:24px;line-height:32px;font-weight:700;color:${HEADING_COLOR};">${escapeHtml(betreff)}</h1>`,
      abstand: ABSTAND.kopfText,
    },
    { html: p(escapeHtml(einzeilig(COPY.mail.gruss(mail.vorname)))), abstand: ABSTAND.absatz },
    ...absatzBausteine(mail.absaetze),
    ...(mail.block === undefined ? [] : [blockHtml(mail.block)]),
    ...absatzBausteine(mail.nachBlock ?? []),
    ...(mail.aktion === undefined ? [] : aktionBausteine(mail.aktion)),
    ...(mail.art === "erstkontakt" ? [{ html: p(widerspruchHtml(), SMALL_TEXT), abstand: ABSTAND.block }] : []),
  ];
  // The gap before the footer's rule is the rule's own, whatever the last block asked for.
  const letzter = inhalt.length - 1;
  const koerper = inhalt.map((baustein, index) => (index === letzter ? { ...baustein, abstand: ABSTAND.vorLinie } : baustein));

  const zeile = nichtDu(mail.art);
  const fuss: Baustein[] = [
    { html: `<hr style="border:none;border-top:1px solid ${RULE_COLOR};margin:0;" />`, abstand: ABSTAND.nachLinie },
    { html: p(escapeHtml(VEREIN_ZEILE), FOOTER_TEXT), abstand: ABSTAND.fusszeile },
    {
      html: p(
        rechtsLinks(mail.origin)
          .map(({ label, href }) => linkHtml(href, label))
          .join(" · "),
        FOOTER_TEXT,
      ),
      abstand: ABSTAND.fusszeile,
    },
    // Last, after the footer: it is not part of the message's content.
    ...(zeile === undefined ? [] : [{ html: p(escapeHtml(zeile), MUTED_TEXT), abstand: 0 }]),
  ];

  const bausteine = [...koerper, ...fuss];
  const zellen = bausteine.map(
    ({ html, abstand }, index) => `<div style="margin:0 0 ${String(index === bausteine.length - 1 ? 0 : abstand)}px;">${html}</div>`,
  );

  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(betreff)}</title>
    ${TELEFON_STYLE}
  </head>
  <body style="margin:0;padding:0;background-color:${SURFACE_COLOR};">
    <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${SURFACE_COLOR};opacity:0;">${escapeHtml(vorschauVon(mail))}</div>
    <table ${TABLE_ATTRS} width="100%" style="background-color:${SURFACE_COLOR};">
      <tr>
        <td align="center" style="padding:24px 12px;font-family:${FONT_STACK};">
          <!--[if mso]><table ${TABLE_ATTRS} width="${String(CARD_WIDTH)}" align="center"><tr><td><![endif]-->
          <table ${TABLE_ATTRS} width="100%" align="center" lang="de" style="max-width:${String(CARD_WIDTH)}px;margin:0 auto;background-color:${CARD_COLOR};border-radius:12px;">
            <tr>
              <td class="fl-pad" style="padding:${String(ABSTAND.karte)}px;font-family:${FONT_STACK};">
                ${zellen.join("\n                ")}
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

function aktionText(aktion: NonNullable<Mail["aktion"]>): string[] {
  if ("links" in aktion)
    return aktion.links.flatMap(({ name, href }, index) => [...(index === 0 ? [] : [""]), `${einzeilig(name)}:`, einzeilig(href)]);

  return [`${einzeilig(aktion.label)}: ${einzeilig(aktion.href)}`];
}

function renderText(mail: Mail, betreff: string): string {
  const gruppen: string[][] = [
    [betreff],
    [einzeilig(COPY.mail.gruss(mail.vorname))],
    ...mail.absaetze.map((absatz) => [absatzText(absatz)]),
    ...(mail.block === undefined
      ? []
      : [
          "code" in mail.block
            ? [einzeilig(mail.block.code)]
            : mail.block.fakten.map(({ label, wert }) => `${einzeilig(label)}: ${wertText(wert)}`),
        ]),
    ...(mail.nachBlock ?? []).map((absatz) => [absatzText(absatz)]),
    ...(mail.aktion === undefined ? [] : [aktionText(mail.aktion)]),
    ...(mail.art === "erstkontakt" ? [[COPY.mail.widerspruch]] : []),
    [VEREIN_ZEILE, ...rechtsLinks(mail.origin).map(({ label, href }) => `${label}: ${href}`)],
  ];
  const zeile = nichtDu(mail.art);

  return [...gruppen, ...(zeile === undefined ? [] : [[zeile]])].map((gruppe) => gruppe.join("\n")).join("\n\n");
}

/** One mail in both versions, from the same data, with the sender its kind names. */
export function renderMail(mail: Mail): GerenderteMail {
  // One line: a break in a subject is a header injection.
  const betreff = einzeilig(mail.betreff);

  return { subject: betreff, html: renderHtml(mail, betreff), text: renderText(mail, betreff), von: VON[mail.art] };
}
