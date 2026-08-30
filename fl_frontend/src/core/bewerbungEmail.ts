import "server-only";

import { KONTAKT_EMAIL, SITE_URL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_CLASS,
  BRAND_COLOR,
  BRAND_NAME,
  brandPhrase,
  escapeHtml,
  escapeHtmlLines,
  HEAD_CLASS,
  HEADING_COLOR,
  LABEL_TEXT,
  link,
  PANEL_CLASS,
  paragraph,
  renderKarte,
  RULE_COLOR,
  strong,
  stuffSignatureDelimiter,
  SURFACE_COLOR,
  TABLE_ATTRS,
  TEXT_CLASS,
  TEXT_COLOR,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

/**
 * Future tense because it has to be: a club is entered only while its season is `future`
 * (`REQ-ENTER-001`), and `future` is the one status the public tier is refused
 * (`fl_backend/app/api/saisons/services.py :: WITHHELD_FROM_BASE_TIER`).
 */
const WEBSITE_SATZ = { vor: "Spielplan, Tabelle und Ergebnisse veröffentlichen wir auf ", nach: ", sobald die Saison startet." } as const;

/**
 * For the reader who never applied: anybody can type any address into a public form. Last in the
 * body and above the buttons, never in the grey close a reader skims -- and in `renderHtml`, so
 * no application message can ship without it.
 */
const IGNORIER_SATZ = `Du weißt nichts von einer Bewerbung bei der ${BRAND_NAME}? Dann ignoriere diese E-Mail einfach. Für Dich ist nichts zu tun.`;

/**
 * Who a message reached, in the words its close states it in. Per message and not one line for all
 * three: a sentence naming who ELSE read this has to be true of the message it stands under.
 */
const EMPFAENGER_SATZ = {
  kontaktpersonen: "Diese E-Mail geht an die Kontaktpersonen der Bewerbung.",
  // The receipt alone, which reaches the seat named as Ansprechperson and nobody else
  // (`fl_frontend/src/features/bewerbungen/notifications.ts :: collectBewerbungEingangEmpfaenger`).
  ansprechperson: "Diese E-Mail geht nur an die Ansprechperson der Bewerbung.",
} as const;

type Empfaengerkreis = keyof typeof EMPFAENGER_SATZ;

/**
 * The one page every reader can use, whatever their message said. In `AKTIONEN` and not per
 * message, so none can point elsewhere -- and named as `BewerbungView.tsx :: KOPF_LINKS` names it.
 */
const LIGA_AKTION = { label: "Laufende Saison", href: `${SITE_URL}/dashboard` } as const;

/** The same pair on all three, in the landing page's own order: the offered action first, the way on beside it. */
const AKTIONEN: readonly Aktion[] = [
  { href: `mailto:${KONTAKT_EMAIL}`, label: "Frage stellen", ton: "primary" },
  { href: LIGA_AKTION.href, label: LIGA_AKTION.label, ton: "outline" },
];

export type BewerbungEmail = { subject: string; html: string; text: string };

/**
 * What an accepted application is told. `gruppe`, `trikotFarbeLabel` and `rollenText` arrive rendered
 * because their vocabularies live in `fl_frontend/src/features/`, which `core` may not import
 * (`eslint.config.mjs :: LAYER_BOUNDARY`).
 */
export interface BewerbungZusageData {
  teamName: string;
  saisonId: string;
  /** The seats THIS reader holds, already one German phrase: one person can hold two, and gets one message naming both. */
  rollenText: string;
  gruppe: string;
  /** Absent while no kit colour has been assigned; the message then states that rather than guessing one. */
  trikotFarbeLabel: string | null;
}

/** What a declined application is told. `grund` is the administrator's own wording, carried verbatim. */
export interface BewerbungAbsageData {
  teamName: string;
  saisonId: string;
  /** As on the acceptance, and for the same reason: a reader has to be able to place a message before reading it. */
  rollenText: string;
  grund: string;
}

/**
 * What a submitted application is told back. **The season, the reader's own seat, and nothing else**:
 * this goes out unprompted to an address nobody has confirmed yet, so it carries no copy of what the
 * form was told about anybody else.
 */
export interface BewerbungEingangData {
  saisonId: string;
  /** As on the acceptance: the seats this one reader holds, rendered. */
  rollenText: string;
}

/** The indent a stacked value's own lines carry, so none of them begins where a label does. */
const FORTSETZUNG = "  ";

/**
 * One line, whatever was typed. The text branch is line-oriented and `escapeHtml` guards the other
 * one, so a break here is the text half's injection: a value carrying one would render a line the
 * reader cannot tell from the facts around it.
 */
function einzeilig(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/**
 * A stacked value keeps its breaks -- a stated reason is a paragraph -- and gives up column 0, which
 * is the only thing that made its lines readable as further facts.
 */
function eingerueckt(value: string): string {
  return value.replace(/\r\n|\r|\n/g, `\n${FORTSETZUNG}`);
}

/**
 * One stated fact, raw. Both branches render from the same list, which is what stops the markup half
 * carrying a fact the text half lost; only the markup half escapes.
 */
interface Fakt {
  readonly label: string;
  readonly value: string;
  /** The season, whose year carries the brand colour in the panel as the whole phrase does in the heading. */
  readonly akzent?: boolean;
  /** Free text: its own full-width row, and no emphasis grade -- a stated reason runs to 1000 characters. */
  readonly gestapelt?: boolean;
}

/** One message as both branches read it, everything raw: the render helpers are the only place values are escaped. */
interface Nachricht {
  /** The heading up to the season, which every heading ends on and which `saisonPhrase` colours. */
  readonly headingVor: string;
  readonly saisonId: string;
  readonly empfaenger: Empfaengerkreis;
  readonly fakten: readonly Fakt[];
}

/** The brand colour on „Saison NNNN“ wherever it stands whole, which is the phrase all three messages turn on. */
function saisonPhrase(saisonId: string): string {
  return brandPhrase(`Saison ${escapeHtml(saisonId)}`);
}

/** The plain heading, which the text branch opens on and the markup branch splits at the season. */
function ueberschrift({ headingVor, saisonId }: Nachricht): string {
  return `${headingVor} Saison ${saisonId}`;
}

/** One row of the panel. Padding is per cell because the panel's inset is its own first and last row. */
function faktZeile(fakt: Fakt, oben: number, unten: number): string {
  const label = escapeHtml(fakt.label);

  /* The category name is set like „Verein“ or „Kürzel“ whatever it names, so the brand colour marks
     one thing in the panel: the value it belongs to. */
  const labelStil = `${LABEL_TEXT}color:${TEXT_COLOR};`;
  const akzent = fakt.akzent === true;

  /* Its own full-width pair of rows, and its value left OUT of the value column: a thousand
     characters in the 35% that is left would set one or two words to the line. */
  if (fakt.gestapelt === true) {
    return `<tr><td colspan="2" class="${TEXT_CLASS}" style="padding:${oben}px 18px 2px;${labelStil}">${label}:</td></tr>
                        <tr><td colspan="2" class="${HEAD_CLASS}" style="padding:0 18px ${unten}px;${LABEL_TEXT}color:${HEADING_COLOR};">${escapeHtmlLines(fakt.value)}</td></tr>`;
  }

  return `<tr>
                          <td width="35%" valign="top" class="${TEXT_CLASS}" style="padding:${oben}px 12px ${unten}px 18px;${labelStil}">${label}:</td>
                          <td valign="top" class="${akzent ? BRAND_CLASS : HEAD_CLASS}" style="padding:${oben}px 18px ${unten}px 0;${LABEL_TEXT}color:${akzent ? BRAND_COLOR : HEADING_COLOR};font-weight:700;">${escapeHtml(fakt.value)}</td>
                        </tr>`;
}

/**
 * The facts a reader must not have to hunt for, panelled above the prose that no longer repeats them.
 * The gap below is a wrapper cell's padding: Outlook honours that where it ignores a table's margin.
 */
function renderFakten(fakten: readonly Fakt[]): string {
  const letzte = fakten.length - 1;
  const zeilen = fakten.map((fakt, index) => faktZeile(fakt, index === 0 ? 14 : 5, index === letzte ? 14 : 5));

  return `<table ${TABLE_ATTRS} width="100%">
                  <tr>
                    <td style="padding:0 0 20px;">
                      <table ${TABLE_ATTRS} width="100%" class="${PANEL_CLASS}" style="background-color:${SURFACE_COLOR};border:1px solid ${RULE_COLOR};border-radius:8px;">
                        ${zeilen.join("\n                        ")}
                      </table>
                    </td>
                  </tr>
                </table>`;
}

/** The shell's card, filled with this message: the panel, its prose, and the note every reader may need. */
function renderHtml(nachricht: Nachricht, bloecke: readonly string[]): string {
  const { headingVor, saisonId, empfaenger, fakten } = nachricht;

  return renderKarte({
    titel: ueberschrift(nachricht),
    ueberschrift: `${escapeHtml(headingVor)} ${saisonPhrase(saisonId)}`,
    bloecke: [renderFakten(fakten), ...bloecke, paragraph(IGNORIER_SATZ, "0", ASIDE_TEXT)],
    aktionen: AKTIONEN,
    fuss: `${EMPFAENGER_SATZ[empfaenger]} ${ANTWORT_SATZ_HTML}`,
  });
}

/**
 * The text branch of one message: the heading, the same facts, the body, then the note and the second
 * control. Stuffed WHOLE rather than per value, so no field is left out of the guard.
 */
function renderText(nachricht: Nachricht, body: readonly string[]): string {
  // A blank line before a stacked fact, so the lines it wraps onto do not read as further facts.
  // Guarded here rather than trusted from the payload: this renderer is correct on its own, and the
  // one field that may hold breaks is stated as a block rather than folded onto one line.
  const zeile = (fakt: Fakt): string =>
    fakt.gestapelt === true ? `${fakt.label}: ${eingerueckt(fakt.value)}` : `${fakt.label}: ${einzeilig(fakt.value)}`;
  const fakten = nachricht.fakten.flatMap((fakt) => (fakt.gestapelt === true ? ["", zeile(fakt)] : [zeile(fakt)]));
  const oben = [`${BRAND_NAME}: ${ueberschrift(nachricht)}`, "", ...fakten, "", ...body];
  // The contact address is the footer's, stated once: the markup branch has two slots for it and this
  // one has a single line. The note closes the body here as it closes the card there.
  const unten = [IGNORIER_SATZ, "", `${LIGA_AKTION.label}: ${LIGA_AKTION.href}`];
  const fuss = textFooter([EMPFAENGER_SATZ[nachricht.empfaenger], ANTWORT_SATZ_TEXT]);

  return [stuffSignatureDelimiter(oben.join("\n")), "", ...unten, ...fuss].join("\n");
}

/**
 * **The two parts state the same facts.** A mail client renders one or the other, so anything only the
 * text half carried would reach only the readers whose client refuses HTML.
 */
export function buildBewerbungZusageEmail({ teamName, saisonId, rollenText, gruppe, trikotFarbeLabel }: BewerbungZusageData): BewerbungEmail {
  // Folded once, before either branch: the name reaches this message's prose as well as its panel, and
  // both halves must state one string. `fl_frontend/src/core/bewerbungEmail.ts :: renderText` folds the
  // facts it prints and nothing else.
  const team = einzeilig(teamName);

  const nachricht: Nachricht = {
    headingVor: "Zusage für die",
    saisonId: saisonId,
    empfaenger: "kontaktpersonen",
    fakten: [
      { label: "Entscheidung", value: "Zusage" },
      { label: "Team", value: team },
      { label: "Saison", value: saisonId, akzent: true },
      { label: "Gruppe", value: gruppe },
      // Stated rather than guessed, and stated as a row either way: an absent colour is a fact the
      // reader has to be able to find in the same place as a named one.
      { label: "Trikotfarbe", value: trikotFarbeLabel ?? "noch nicht festgelegt" },
      // The one row that differs per reader: three people get this message and each is told the seat
      // they were entered for.
      { label: "Eingetragen als", value: rollenText },
    ],
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `${strong(escapeHtml(team))} ist für die ${saisonPhrase(saisonId)} der ${BRAND_NAME} aufgenommen. Wir freuen uns auf die gemeinsame Saison.`,
    ),
    paragraph(`${WEBSITE_SATZ.vor}${link(SITE_URL, SITE_URL)}${WEBSITE_SATZ.nach}`),
  ]);

  const text = renderText(nachricht, [
    `${team} ist für die Saison ${saisonId} der ${BRAND_NAME} aufgenommen.`,
    "Wir freuen uns auf die gemeinsame Saison.",
    "",
    `${WEBSITE_SATZ.vor}${SITE_URL}${WEBSITE_SATZ.nach}`,
  ]);

  return { subject: `Zusage: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/**
 * **The two parts state the same facts**, as in the acceptance above. The message states the decision
 * and the reason it was given, and says that it covers this application rather than the school.
 */
export function buildBewerbungAbsageEmail({ teamName, saisonId, rollenText, grund }: BewerbungAbsageData): BewerbungEmail {
  // Folded once, as on the acceptance and for the same reason.
  const team = einzeilig(teamName);

  const nachricht: Nachricht = {
    headingVor: "Absage für die",
    saisonId: saisonId,
    empfaenger: "kontaktpersonen",
    fakten: [
      { label: "Entscheidung", value: "Absage" },
      { label: "Team", value: team },
      { label: "Saison", value: saisonId, akzent: true },
      // In the same place as in the other two, and identification rather than a verdict: it says why
      // the message reached this reader, and never what they were down for.
      { label: "Eingetragen als", value: rollenText },
      // Unabridged and last, where the panel can give it the full width: it is the one thing the
      // message exists to hand over, and a reader who skims the rest still has to arrive at it.
      { label: "Angegebener Grund", value: grund, gestapelt: true },
    ],
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `Danke, dass ${strong(escapeHtml(team))} sich für die ${saisonPhrase(saisonId)} der ${BRAND_NAME} beworben hat. Für diese Saison können wir das Team nicht aufnehmen.`,
    ),
    paragraph("Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter."),
  ]);

  const text = renderText(nachricht, [
    `Danke, dass ${team} sich für die Saison ${saisonId} der ${BRAND_NAME} beworben hat.`,
    "Für diese Saison können wir das Team nicht aufnehmen.",
    "",
    "Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter.",
  ]);

  return { subject: `Absage: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/**
 * **The two parts state the same facts**, as in the two decisions above.
 *
 * Of what was submitted it repeats the reader's own seat and nothing else: this is the one message
 * the league sends before anybody has confirmed the address it goes to.
 */
export function buildBewerbungEingangEmail({ saisonId, rollenText }: BewerbungEingangData): BewerbungEmail {
  const nachricht: Nachricht = {
    headingVor: "Bewerbung für die",
    saisonId: saisonId,
    empfaenger: "ansprechperson",
    fakten: [
      { label: "Status", value: "Bewerbung eingegangen" },
      { label: "Saison", value: saisonId, akzent: true },
      // This message goes to one seat, and naming it is what tells a reader who did not fill the form
      // in why it reached them.
      { label: "Eingetragen als", value: rollenText },
    ],
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `Deine Bewerbung für die ${saisonPhrase(saisonId)} der ${BRAND_NAME} ist ${strong("bei uns eingegangen")}. Danke für die Anmeldung Deines Teams.`,
    ),
    // What happens next, and how long it takes: without it the only answer to "und jetzt?" is a
    // second application, which is the one thing this message exists to make unnecessary.
    paragraph(
      `Wir schauen sie uns an und melden uns bei allen drei Kontaktpersonen, sobald wir entschieden haben. ${strong("Du musst nichts weiter tun.")}`,
    ),
    paragraph(`${WEBSITE_SATZ.vor}${link(SITE_URL, SITE_URL)}${WEBSITE_SATZ.nach}`),
  ]);

  const text = renderText(nachricht, [
    `Deine Bewerbung für die Saison ${saisonId} der ${BRAND_NAME} ist bei uns eingegangen.`,
    "Danke für die Anmeldung Deines Teams.",
    "",
    "Wir schauen sie uns an und melden uns bei allen drei Kontaktpersonen, sobald wir entschieden haben.",
    "Du musst nichts weiter tun.",
    "",
    `${WEBSITE_SATZ.vor}${SITE_URL}${WEBSITE_SATZ.nach}`,
  ]);

  return { subject: `Bewerbung eingegangen: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}
