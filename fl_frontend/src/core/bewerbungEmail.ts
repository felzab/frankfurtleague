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
 * A wish answered as one. The Spielplan is drawn after the decision, so nothing here knows whether it
 * can be met, and „wir versuchen“ would promise a result of a draw that has not run (my wording).
 */
const wunschgegnerSatz = (gegner: string): string =>
  `Als Wunschgegner für den ersten Spieltag haben wir ${gegner} notiert; über die Paarungen entscheidet der Spielplan.`;

/**
 * For the reader who never applied: anybody can type any address into a public form. Last in the
 * body and above the buttons, never in the grey close a reader skims -- and in `renderHtml`, so
 * no application message can ship without it.
 */
const IGNORIER_VOR = `Du weißt nichts von einer Bewerbung bei der ${BRAND_NAME}? Dann ignoriere diese E-Mail einfach. Für Dich ist nichts zu tun`;
const IGNORIER_SATZ = `${IGNORIER_VOR}.`;
/* What ignoring costs: a contact can end their seat through the link, the submitter can only wait,
   and after the deletion nothing is left to promise. One wording for all three offers a route
   somebody has not got. */
const IGNORIER_SATZ_EINTRAG = `${IGNORIER_VOR}: Deine Angaben werden nach 14 Tagen gelöscht. Oder lehne über den Link ab, dann entfernen wir sie sofort.`;
/* Its own wording rather than the singular one over two links: „den Link“ names one of the two the
   message carries, and the reader cannot tell which of them is being offered. */
const IGNORIER_SATZ_EINTRAG_MEHRERE = `Weiß hier niemand von einer Bewerbung bei der ${BRAND_NAME}? Dann ignoriert diese E-Mail einfach. Für Euch ist nichts zu tun: Eure Angaben werden nach 14 Tagen gelöscht. Oder lehnt über die Links ab, dann entfernen wir sie sofort.`;
const IGNORIER_SATZ_BEWERBUNG = `${IGNORIER_VOR}: die Bewerbung wird nach 14 Tagen gelöscht.`;
const IGNORIER_SATZ_GELOESCHT = `${IGNORIER_VOR}: die Bewerbung wurde gelöscht.`;

/**
 * Who a message reached, in the words its close states it in. Per message and not one line for all
 * of them: a sentence naming who ELSE read this has to be true of the message it stands under.
 */
const EMPFAENGER_SATZ = {
  kontaktpersonen: "Diese E-Mail geht an die Kontaktpersonen der Bewerbung.",
  eintrag: "Diese E-Mail geht nur an Dich.",
  // Says why a message about other people reached this reader: on a shared school inbox the other
  // reading is that the league mailed somebody their colleagues' details by mistake.
  postfach: "Diese E-Mail geht an dieses Postfach, weil dort mehrere Einträge hängen.",
  einreichende: "Diese E-Mail geht nur an die Person, die die Bewerbung eingereicht hat.",
} as const;

type Empfaengerkreis = keyof typeof EMPFAENGER_SATZ;

/**
 * The one page every reader who is waiting on the league can use, named as
 * `BewerbungView.tsx :: KOPF_LINKS` names it.
 */
const LIGA_AKTION = { label: "Laufende Saison", href: `${SITE_URL}/dashboard` } as const;

/** The way to a person, offered wherever the message leaves the reader with a question. */
const FRAGE_AKTION = { label: "Frage stellen", href: `mailto:${KONTAKT_EMAIL}` } as const;

/** The pair the two decisions and the completion notice carry, in the landing page's own order: the offered action first, the way on beside it. */
const AKTIONEN: readonly Aktion[] = [
  { href: FRAGE_AKTION.href, label: FRAGE_AKTION.label, ton: "primary" },
  { href: LIGA_AKTION.href, label: LIGA_AKTION.label, ton: "outline" },
];

/** `AKTIONEN` as lines. The contact address is the close's already, so only the page is listed. */
const TEXT_AKTIONEN: readonly string[] = [`${LIGA_AKTION.label}: ${LIGA_AKTION.href}`];

/**
 * Where a school starts again. The id is percent-encoded rather than interpolated raw: it lands in
 * an href, and `escapeHtml` guards an HTML context rather than a URL's own syntax.
 */
function neuBewerbenAktion(saisonId: string): Aktion {
  return { href: `${SITE_URL}/bewerbung/${encodeURIComponent(saisonId)}`, label: "Neu bewerben", ton: "primary" };
}

// Spelled here as well as in `fl_frontend/src/core/authEmail.ts :: FALLBACK_SATZ`: one situation
// reads as one sentence to the person meeting it, so the two move together.
const FALLBACK_SATZ = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";
/** The singular sentence standing over two addresses tells its reader that one of them is theirs. */
const FALLBACK_SATZ_MEHRERE = "Falls die Buttons nicht funktionieren, kopiert diese Adressen in Euren Browser:";

/**
 * German lists nothing with a comma before its last item. In `core` because both the message naming
 * a seat list and the fan-out addressing it need one, and
 * `fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY` shares code this way alone.
 */
export function joinUnd(labels: readonly string[]): string {
  if (labels.length < 2) return labels[0] ?? "";

  return `${labels.slice(0, -1).join(", ")} und ${labels[labels.length - 1]!}`;
}

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
  /** Absent where the school named none, and the message then says nothing: a draw that has not run can promise nothing. */
  wunschgegner?: string | null;
}

/** What a declined application is told. `grund` is the administrator's own wording, carried verbatim. */
export interface BewerbungAbsageData {
  teamName: string;
  saisonId: string;
  /** As on the acceptance, and for the same reason: a reader has to be able to place a message before reading it. */
  rollenText: string;
  grund: string;
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
  /* Stated per message and never defaulted: a message inheriting another's controls sends its
     reader to a page its own copy has just made wrong. */
  readonly aktionen: readonly Aktion[];
  /** The same controls as lines, a button being nothing the text branch can draw. */
  readonly textAktionen: readonly string[];
  /* Stated per message, because what ignoring costs differs. Defaulted, it would tell a contact
     whose own seat is holding the application open that there is nothing to do. */
  readonly ignorierSatz: string;
}

/** The brand colour on „Saison NNNN“ wherever it stands whole, which is the phrase every message turns on. */
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
  const { headingVor, saisonId, empfaenger, fakten, aktionen, ignorierSatz } = nachricht;

  return renderKarte({
    titel: ueberschrift(nachricht),
    ueberschrift: `${escapeHtml(headingVor)} ${saisonPhrase(saisonId)}`,
    bloecke: [renderFakten(fakten), ...bloecke, paragraph(ignorierSatz, "0", ASIDE_TEXT)],
    aktionen: aktionen,
    fuss: `${EMPFAENGER_SATZ[empfaenger]} ${ANTWORT_SATZ_HTML}`,
  });
}

/**
 * The text branch of one message: the heading, the same facts, the body, then the note and the second
 * control. Stuffed WHOLE rather than per value, so no field is left out of the guard.
 */
function renderText(nachricht: Nachricht, body: readonly string[]): string {
  // A blank line before a stacked fact, so the lines it wraps onto do not read as further facts.
  // Both shapes are normalised here rather than trusted from the payload (`docs/frontend/spec.md :: I85`).
  const zeile = (fakt: Fakt): string =>
    fakt.gestapelt === true ? `${fakt.label}: ${eingerueckt(fakt.value)}` : `${fakt.label}: ${einzeilig(fakt.value)}`;
  // Blank on both sides, so a stacked value's wrapped lines read as neither the fact above nor the
  // one below. The closing blank is dropped where nothing follows, which would double the one
  // `oben` puts before the body.
  const letzte = nachricht.fakten.length - 1;
  const fakten = nachricht.fakten.flatMap((fakt, index) =>
    fakt.gestapelt === true ? ["", zeile(fakt), ...(index === letzte ? [] : [""])] : [zeile(fakt)],
  );
  const oben = [`${BRAND_NAME}: ${ueberschrift(nachricht)}`, "", ...fakten, "", ...body];
  // The note closes the body here as it closes the card there, and a message whose links all stand
  // in its prose lists nothing under it rather than closing on a blank line.
  const unten = [nachricht.ignorierSatz, ...(nachricht.textAktionen.length === 0 ? [] : ["", ...nachricht.textAktionen])];
  const fuss = textFooter([EMPFAENGER_SATZ[nachricht.empfaenger], ANTWORT_SATZ_TEXT]);

  return [stuffSignatureDelimiter(oben.join("\n")), "", ...unten, ...fuss].join("\n");
}

/**
 * **The two parts state the same facts.** A mail client renders one or the other, so anything only the
 * text half carried would reach only the readers whose client refuses HTML.
 */
export function buildBewerbungZusageEmail({
  teamName,
  saisonId,
  rollenText,
  gruppe,
  trikotFarbeLabel,
  wunschgegner,
}: BewerbungZusageData): BewerbungEmail {
  // Folded once, before either branch: the name reaches this message's prose as well as its panel, and
  // both halves must state one string. `fl_frontend/src/core/bewerbungEmail.ts :: renderText` folds the
  // facts it prints and nothing else.
  const team = einzeilig(teamName);
  // Folded for a reason `renderText` cannot cover: this one stands in the prose ALONE, so no fact line
  // it prints would ever reach it. Blank counts as unnamed, so the silence rests on no payload's trim.
  const gegner = einzeilig(wunschgegner ?? "").trim();

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
    aktionen: AKTIONEN,
    textAktionen: TEXT_AKTIONEN,
    ignorierSatz: IGNORIER_SATZ,
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `${strong(escapeHtml(team))} ist für die ${saisonPhrase(saisonId)} der ${BRAND_NAME} aufgenommen. Wir freuen uns auf die gemeinsame Saison.`,
    ),
    // Unemphasised, unlike the name above it: a school skims the bold, and a club set in it would read
    // as the fixture the draw has not drawn.
    ...(gegner === "" ? [] : [paragraph(wunschgegnerSatz(escapeHtml(gegner)))]),
    paragraph(`${WEBSITE_SATZ.vor}${link(SITE_URL, SITE_URL)}${WEBSITE_SATZ.nach}`),
  ]);

  const text = renderText(nachricht, [
    `${team} ist für die Saison ${saisonId} der ${BRAND_NAME} aufgenommen.`,
    "Wir freuen uns auf die gemeinsame Saison.",
    // The separating blank line rides WITH the sentence, so an unnamed opponent leaves no gap behind.
    ...(gegner === "" ? [] : ["", wunschgegnerSatz(gegner)]),
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
    aktionen: AKTIONEN,
    textAktionen: TEXT_AKTIONEN,
    ignorierSatz: IGNORIER_SATZ,
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

/** One seat, as a message names it to somebody who is not sitting in it. */
export interface BewerbungSeat {
  readonly vorname: string;
  /**
   * `fl_frontend/src/features/bewerbungen/constants.ts :: BEWERBUNG_SEATS`'s `label`, which that
   * file maps from `fl_frontend/src/features/teams/constants.ts :: KONTAKT_ROLLEN`'s `langform`.
   * Rendered by the caller because `core` may not import `features`
   * (`fl_frontend/eslint.config.mjs :: LAYER_BOUNDARY`).
   */
  readonly rolleText: string;
}

/** A seat and the link that answers for it. */
export interface BewerbungLinkSeat extends BewerbungSeat {
  /** The finished absolute URL. The token inside it is a bearer credential and is never taken apart here. */
  readonly link: string;
}

/**
 * What one MAILBOX is asked to confirm. `seats` holds one entry per link that mailbox was sent, so
 * two people sharing a school inbox arrive as two entries and one person holding two seats under a
 * single link as one.
 */
export interface BewerbungBestaetigungData {
  saisonId: string;
  schule: string;
  /* At least one, in the type: an empty list renders an empty fact row, a control row with no
     control in it, and the sentence offering an address over nothing. */
  seats: readonly [BewerbungLinkSeat, ...BewerbungLinkSeat[]];
  /**
   * The deadline as a German date, rendered by the caller for the reason `rollenText` is:
   * `fl_frontend/src/shared/utils/format.ts :: formatSpielDatum` sits in a layer `core` may not reach.
   */
  fristText: string;
}

/** „{vorname} ({rolle})“, which is how every message naming somebody else's seat names it. */
function seatName({ vorname, rolleText }: BewerbungSeat): string {
  return `${einzeilig(vorname)} (${einzeilig(rolleText)})`;
}

/** The plural form names whose each row is; the singular one has nobody to tell its reader apart from. */
function seatFakten(seats: BewerbungBestaetigungData["seats"]): Fakt[] {
  if (seats.length < 2) return [{ label: "Eingetragen als", value: einzeilig(seats[0].rolleText) }];

  return seats.map((seat) => ({ label: "Eingetragen als", value: seatName(seat) }));
}

/** One control per entry, which `notifications.ts :: seatsByMailbox` makes one per link rather than one per seat. */
function seatAktionen(seats: readonly BewerbungLinkSeat[]): Aktion[] {
  return seats.map((seat) => ({
    href: einzeilig(seat.link),
    label: seats.length < 2 ? "Eintrag bestätigen" : `Eintrag bestätigen: ${seatName(seat)}`,
    ton: "primary",
  }));
}

/** One address a reader can copy. `label` is empty where the message carries a single one and there is nothing to tell apart. */
type Fallback = { readonly label: string; readonly url: string };

/** Named only in the plural: an unlabelled second URL is a link nobody can place. */
function seatFallbacks(seats: readonly BewerbungLinkSeat[]): Fallback[] {
  return seats.map((seat) => ({ label: seats.length < 2 ? "" : seatName(seat), url: einzeilig(seat.link) }));
}

/** The route for a reader whose client drew no button. */
function fallbackBloecke(adressen: readonly Fallback[], satz: string): string[] {
  const adresse = ({ label, url }: Fallback, index: number): string => {
    /* Breaking inside a word, as `fl_frontend/src/core/authEmail.ts` does with its signed URL: a
       token URL is longer than the card is wide and would otherwise push the card open. */
    const stil = `${ASIDE_TEXT}word-break:break-all;`;

    return paragraph(
      `${label === "" ? "" : `${escapeHtml(label)}: `}${link(url, url)}`,
      index === adressen.length - 1 ? "0 0 16px" : "0 0 8px",
      stil,
    );
  };

  return [paragraph(satz, "0 0 8px", ASIDE_TEXT), ...adressen.map(adresse)];
}

/** The same addresses as lines. A label shares no line with its URL: that is what stops a client linkifying both as one. */
function fallbackZeilen(adressen: readonly Fallback[]): string[] {
  return adressen.flatMap(({ label, url }, index) => [...(index === 0 ? [] : [""]), ...(label === "" ? [] : [`${label}:`]), url]);
}

/** Both link messages open on this, and only the school and the season in it are theirs to differ on. */
function eingereichtSatz(schuleText: string, saisonId: string, markup: boolean): string {
  const schule = markup ? strong(escapeHtml(schuleText)) : schuleText;
  const saison = markup ? saisonPhrase(saisonId) : `Saison ${saisonId}`;

  return `Für die Schule ${schule} wurde eine Bewerbung zur ${saison} der ${BRAND_NAME} eingereicht.`;
}

/** **The two parts state the same facts**, as in the messages above. */
export function buildBewerbungBestaetigungEmail({ saisonId, schule, seats, fristText }: BewerbungBestaetigungData): BewerbungEmail {
  const mehrere = seats.length > 1;
  const schuleText = einzeilig(schule);
  const frist = einzeilig(fristText);
  const rollen = einzeilig(seats[0].rolleText);
  const offen = joinUnd(seats.map(seatName));

  const nachricht: Nachricht = {
    headingVor: mehrere ? "Eure Einträge für die" : "Dein Eintrag für die",
    saisonId: saisonId,
    empfaenger: mehrere ? "postfach" : "eintrag",
    fakten: [
      // Named here and in no message to the submitter: a contact who never heard of the application
      // has nothing else to tell whose it is, and cannot answer a link they cannot place.
      { label: "Schule", value: schuleText },
      { label: "Saison", value: saisonId, akzent: true },
      ...seatFakten(seats),
      { label: mehrere ? "Links gültig bis" : "Link gültig bis", value: frist },
    ],
    aktionen: seatAktionen(seats),
    // Nothing under the note: every link this message offers already stands in its body, where the
    // text branch's reader has met it in the prose.
    textAktionen: [],
    ignorierSatz: mehrere ? IGNORIER_SATZ_EINTRAG_MEHRERE : IGNORIER_SATZ_EINTRAG,
  };

  const html = renderHtml(nachricht, [
    paragraph(
      mehrere
        ? `${eingereichtSatz(schuleText, saisonId, true)} Mit dieser E-Mail-Adresse sind darin ${escapeHtml(offen)} eingetragen. ${strong("Bitte bestätigt jeden Eintrag einzeln")}: Erst dann führt die Liga Euch als Kontaktpersonen.`
        : `${eingereichtSatz(schuleText, saisonId, true)} Darin bist Du als ${escapeHtml(rollen)} eingetragen. ${strong("Bitte bestätige, dass das stimmt")}: Erst dann führt die Liga Dich als Kontaktperson.`,
    ),
    paragraph(
      mehrere
        ? `Klickt auf die Buttons und gebt dort nur Euer Geburtsdatum ein, sonst nichts: Kontaktperson kann sein, wer mindestens 16 ist. Jeder Eintrag lässt sich bestätigen oder ablehnen. Jeder Link ist bis zum ${strong(escapeHtml(frist))} gültig und funktioniert nur einmal.`
        : `Klicke auf den Button. Auf der Seite gibst Du nur Dein Geburtsdatum ein, sonst nichts: Kontaktperson kann sein, wer mindestens 16 ist. Du kannst den Eintrag bestätigen oder ablehnen. Der Link ist bis zum ${strong(escapeHtml(frist))} gültig und funktioniert nur einmal.`,
    ),
    paragraph(
      mehrere
        ? "Ohne Eure Bestätigungen bleibt die Bewerbung unvollständig. Nach drei Tagen erinnern wir Euch einmal; ist die Bewerbung nach 14 Tagen noch unvollständig, löschen wir sie mit allen Angaben."
        : "Ohne Deine Bestätigung bleibt die Bewerbung unvollständig. Nach drei Tagen erinnern wir Dich einmal; ist die Bewerbung nach 14 Tagen noch unvollständig, löschen wir sie mit allen Angaben.",
    ),
    ...fallbackBloecke(seatFallbacks(seats), mehrere ? FALLBACK_SATZ_MEHRERE : FALLBACK_SATZ),
  ]);

  const text = renderText(nachricht, [
    eingereichtSatz(schuleText, saisonId, false),
    mehrere ? `Mit dieser E-Mail-Adresse sind darin ${offen} eingetragen.` : `Darin bist Du als ${rollen} eingetragen.`,
    mehrere
      ? "Bitte bestätigt jeden Eintrag einzeln: Erst dann führt die Liga Euch als Kontaktpersonen."
      : "Bitte bestätige, dass das stimmt: Erst dann führt die Liga Dich als Kontaktperson.",
    "",
    mehrere
      ? "Öffnet diese Links und gebt dort nur Euer Geburtsdatum ein, sonst nichts: Kontaktperson kann sein, wer mindestens 16 ist. Jeder Eintrag lässt sich bestätigen oder ablehnen."
      : "Öffne diesen Link. Auf der Seite gibst Du nur Dein Geburtsdatum ein, sonst nichts: Kontaktperson kann sein, wer mindestens 16 ist. Du kannst den Eintrag bestätigen oder ablehnen.",
    mehrere
      ? `Jeder Link ist bis zum ${frist} gültig und funktioniert nur einmal.`
      : `Der Link ist bis zum ${frist} gültig und funktioniert nur einmal.`,
    "",
    ...fallbackZeilen(seatFallbacks(seats)),
    "",
    mehrere
      ? "Ohne Eure Bestätigungen bleibt die Bewerbung unvollständig. Nach drei Tagen erinnern wir Euch einmal;"
      : "Ohne Deine Bestätigung bleibt die Bewerbung unvollständig. Nach drei Tagen erinnern wir Dich einmal;",
    "ist die Bewerbung nach 14 Tagen noch unvollständig, löschen wir sie mit allen Angaben.",
  ]);

  return { subject: `Bitte bestätigen: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/** **The two parts state the same facts**, as in the messages above. */
export function buildBewerbungErinnerungEmail({ saisonId, schule, seats, fristText }: BewerbungBestaetigungData): BewerbungEmail {
  const mehrere = seats.length > 1;
  const schuleText = einzeilig(schule);
  const loeschung = einzeilig(fristText);
  const rollen = einzeilig(seats[0].rolleText);
  const offen = joinUnd(seats.map(seatName));

  const nachricht: Nachricht = {
    headingVor: mehrere ? "Erinnerung: Eure Einträge für die" : "Erinnerung: Dein Eintrag für die",
    saisonId: saisonId,
    empfaenger: mehrere ? "postfach" : "eintrag",
    fakten: [
      { label: "Schule", value: schuleText },
      { label: "Saison", value: saisonId, akzent: true },
      ...seatFakten(seats),
      // The date the first message gave as the link's own: named here by what happens on it, since
      // a reader who has let one deadline pass is not moved by a second one about validity.
      { label: "Bewerbung wird gelöscht am", value: loeschung },
    ],
    // Fresh links, minted beside the first ones rather than in place of them: a reminder that voided
    // the link somebody is still looking at would punish the reader it is chasing.
    aktionen: seatAktionen(seats),
    textAktionen: [],
    ignorierSatz: mehrere ? IGNORIER_SATZ_EINTRAG_MEHRERE : IGNORIER_SATZ_EINTRAG,
  };

  const gebeten = mehrere
    ? "Vor drei Tagen haben wir Euch gebeten, Eure Einträge zu bestätigen:"
    : "Vor drei Tagen haben wir Dich gebeten, Deinen Eintrag zu bestätigen:";
  const fehlt = mehrere ? "Bis jetzt fehlt Eure Antwort." : "Bis jetzt fehlt Deine Antwort.";

  const html = renderHtml(nachricht, [
    paragraph(
      mehrere
        ? `${gebeten} In der Bewerbung der Schule ${strong(escapeHtml(schuleText))} zur ${saisonPhrase(saisonId)} sind mit dieser E-Mail-Adresse ${escapeHtml(offen)} eingetragen. ${strong(fehlt)}`
        : `${gebeten} In der Bewerbung der Schule ${strong(escapeHtml(schuleText))} zur ${saisonPhrase(saisonId)} bist Du als ${escapeHtml(rollen)} eingetragen. ${strong(fehlt)}`,
    ),
    paragraph(
      mehrere
        ? `Klickt auf die Buttons, gebt Euer Geburtsdatum ein und bestätigt die Einträge, oder lehnt sie ab. Ohne Eure Antwort löschen wir die Bewerbung am ${strong(escapeHtml(loeschung))} mit allen Angaben.`
        : `Klicke auf den Button, gib Dein Geburtsdatum ein und bestätige den Eintrag, oder lehne ihn ab. Ohne Deine Antwort löschen wir die Bewerbung am ${strong(escapeHtml(loeschung))} mit allen Angaben.`,
    ),
    ...fallbackBloecke(seatFallbacks(seats), mehrere ? FALLBACK_SATZ_MEHRERE : FALLBACK_SATZ),
  ]);

  const text = renderText(nachricht, [
    gebeten,
    mehrere
      ? `In der Bewerbung der Schule ${schuleText} zur Saison ${saisonId} sind mit dieser E-Mail-Adresse ${offen} eingetragen.`
      : `In der Bewerbung der Schule ${schuleText} zur Saison ${saisonId} bist Du als ${rollen} eingetragen.`,
    fehlt,
    "",
    mehrere
      ? "Öffnet diese Links, gebt Euer Geburtsdatum ein und bestätigt die Einträge, oder lehnt sie ab."
      : "Öffne diesen Link, gib Dein Geburtsdatum ein und bestätige den Eintrag, oder lehne ihn ab.",
    mehrere
      ? `Ohne Eure Antwort löschen wir die Bewerbung am ${loeschung} mit allen Angaben.`
      : `Ohne Deine Antwort löschen wir die Bewerbung am ${loeschung} mit allen Angaben.`,
    "",
    ...fallbackZeilen(seatFallbacks(seats)),
  ]);

  return { subject: `Erinnerung: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/**
 * What the submitter is told at submission, once every contact has been written to. `ausstehend` is
 * the caller's list of seats still waiting, named because the submitter is the one person who can
 * ask a colleague in the corridor.
 */
export interface BewerbungEingangOffenData {
  saisonId: string;
  rollenText: string;
  ausstehend: readonly BewerbungSeat[];
  fristText: string;
  /** The submitter's own link: they hold a seat like the other two and confirm it from this message. */
  link: string;
}

/** The list of seats still waiting, as both branches print it. */
function offeneListe(ausstehend: readonly BewerbungSeat[]): string {
  return joinUnd(ausstehend.map(seatName));
}

/** The pair a message offers when the reader may want to start over: the way forward, then the way to a person. */
function neuBewerbenAktionen(saisonId: string): readonly Aktion[] {
  return [neuBewerbenAktion(saisonId), { href: FRAGE_AKTION.href, label: FRAGE_AKTION.label, ton: "outline" }];
}

/** Those two as lines. The address is spelled bare rather than as a `mailto:`, which is markup a text branch has no reader for. */
function neuBewerbenZeilen(saisonId: string): readonly string[] {
  const neu = neuBewerbenAktion(saisonId);

  return [`${neu.label}: ${neu.href}`, `${FRAGE_AKTION.label}: ${KONTAKT_EMAIL}`];
}

/** **The two parts state the same facts**, as in the messages above. */
export function buildBewerbungEingangOffenEmail({
  saisonId,
  rollenText,
  ausstehend,
  fristText,
  link: bestaetigungsLink,
}: BewerbungEingangOffenData): BewerbungEmail {
  const frist = einzeilig(fristText);
  const url = einzeilig(bestaetigungsLink);
  const offen = offeneListe(ausstehend);

  const nachricht: Nachricht = {
    headingVor: "Bewerbung für die",
    saisonId: saisonId,
    empfaenger: "einreichende",
    // The other contacts by first name and role, and no school: a mistyped submitter address then
    // hands a stranger two first names and two roles with nothing to attach them to.
    fakten: [
      { label: "Status", value: "Eingegangen, Bestätigungen offen" },
      { label: "Saison", value: saisonId, akzent: true },
      { label: "Eingetragen als", value: rollenText },
      // Full width: the list runs to two people with their roles, which in the value column would
      // set one or two words to the line.
      { label: "Noch offen", value: offen, gestapelt: true },
      { label: "Frist", value: frist },
    ],
    aktionen: [
      { href: url, label: "Meinen Eintrag bestätigen", ton: "primary" },
      { href: FRAGE_AKTION.href, label: FRAGE_AKTION.label, ton: "outline" },
    ],
    textAktionen: [`${FRAGE_AKTION.label}: ${KONTAKT_EMAIL}`],
    ignorierSatz: IGNORIER_SATZ_BEWERBUNG,
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `Deine Bewerbung für die ${saisonPhrase(saisonId)} der ${BRAND_NAME} ist ${strong("bei uns eingegangen")}. Danke für die Anmeldung Deines Teams.`,
    ),
    paragraph(
      `Vollständig ist sie, sobald jede Kontaktperson ihren Eintrag selbst bestätigt hat. Dazu hat jede von ihnen einen eigenen Link per E-Mail bekommen, Du auch: ${strong("Deinen findest Du unten.")}`,
    ),
    paragraph(
      `Nach drei Tagen erinnern wir alle, die noch nicht bestätigt haben. Ist die Bewerbung am ${strong(escapeHtml(frist))} noch unvollständig, löschen wir sie mit allen Angaben und sagen Dir Bescheid. Sag den anderen am besten selbst Bescheid, dann geht es schneller.`,
    ),
    ...fallbackBloecke([{ label: "", url: url }], FALLBACK_SATZ),
  ]);

  const text = renderText(nachricht, [
    `Deine Bewerbung für die Saison ${saisonId} der ${BRAND_NAME} ist bei uns eingegangen.`,
    "Danke für die Anmeldung Deines Teams.",
    "",
    "Vollständig ist sie, sobald jede Kontaktperson ihren Eintrag selbst bestätigt hat.",
    "Dazu hat jede von ihnen einen eigenen Link per E-Mail bekommen, Du auch. Deinen findest Du hier:",
    "",
    url,
    "",
    "Nach drei Tagen erinnern wir alle, die noch nicht bestätigt haben.",
    `Ist die Bewerbung am ${frist} noch unvollständig, löschen wir sie mit allen Angaben und sagen Dir Bescheid.`,
    "Sag den anderen am besten selbst Bescheid, dann geht es schneller.",
  ]);

  return { subject: `Bewerbung eingegangen: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/** What the submitter is told the moment the last open seat confirms. */
export interface BewerbungVollstaendigData {
  saisonId: string;
  rollenText: string;
}

/** **The two parts state the same facts**, as in the messages above. */
export function buildBewerbungVollstaendigEmail({ saisonId, rollenText }: BewerbungVollstaendigData): BewerbungEmail {
  const nachricht: Nachricht = {
    headingVor: "Vollständig: Bewerbung für die",
    saisonId: saisonId,
    empfaenger: "einreichende",
    fakten: [
      { label: "Status", value: "Vollständig, in Prüfung" },
      { label: "Saison", value: saisonId, akzent: true },
      { label: "Eingetragen als", value: rollenText },
    ],
    // Nothing is asked of this reader, so the decisions' pair rather than a control of its own: a
    // press here would answer nothing the workflow is waiting for.
    aktionen: AKTIONEN,
    textAktionen: TEXT_AKTIONEN,
    ignorierSatz: IGNORIER_SATZ,
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `${strong("Alle Kontaktpersonen haben ihren Eintrag bestätigt.")} Deine Bewerbung für die ${saisonPhrase(saisonId)} der ${BRAND_NAME} ist damit vollständig, und wir schauen sie uns an.`,
    ),
    paragraph(`Wir melden uns bei allen drei Kontaktpersonen, sobald wir entschieden haben. ${strong("Du musst nichts weiter tun.")}`),
    paragraph(`${WEBSITE_SATZ.vor}${link(SITE_URL, SITE_URL)}${WEBSITE_SATZ.nach}`),
  ]);

  const text = renderText(nachricht, [
    "Alle Kontaktpersonen haben ihren Eintrag bestätigt.",
    `Deine Bewerbung für die Saison ${saisonId} der ${BRAND_NAME} ist damit vollständig, und wir schauen sie uns an.`,
    "",
    "Wir melden uns bei allen drei Kontaktpersonen, sobald wir entschieden haben.",
    "Du musst nichts weiter tun.",
    "",
    `${WEBSITE_SATZ.vor}${SITE_URL}${WEBSITE_SATZ.nach}`,
  ]);

  return { subject: `Bewerbung vollständig: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/**
 * What the submitter is told once the application is gone. `ausstehend` is composed before the
 * delete, the names it carries being in the document the run removes.
 */
export interface BewerbungGeloeschtData {
  saisonId: string;
  rollenText: string;
  ausstehend: readonly BewerbungSeat[];
}

/** **The two parts state the same facts**, as in the messages above. */
export function buildBewerbungGeloeschtEmail({ saisonId, rollenText, ausstehend }: BewerbungGeloeschtData): BewerbungEmail {
  const offen = offeneListe(ausstehend);

  const nachricht: Nachricht = {
    headingVor: "Gelöscht: Bewerbung für die",
    saisonId: saisonId,
    empfaenger: "einreichende",
    fakten: [
      { label: "Status", value: "Gelöscht, nicht vollständig geworden" },
      { label: "Saison", value: saisonId, akzent: true },
      { label: "Eingetragen als", value: rollenText },
      // The one thing a school needs before applying again: told only that the application lapsed,
      // they collect the same people and land here a second time.
      { label: "Nicht bestätigt", value: offen, gestapelt: true },
    ],
    aktionen: neuBewerbenAktionen(saisonId),
    textAktionen: neuBewerbenZeilen(saisonId),
    ignorierSatz: IGNORIER_SATZ_GELOESCHT,
  };

  const html = renderHtml(nachricht, [
    paragraph(
      `14 Tage lang haben nicht alle Kontaktpersonen ihren Eintrag bestätigt. Deshalb haben wir Deine Bewerbung für die ${saisonPhrase(saisonId)} ${strong("mit allen Angaben gelöscht")}, wie angekündigt.`,
    ),
    paragraph(
      "Solange die Bewerbungsfrist läuft, kann sich Deine Schule neu bewerben. Frag die Kontaktpersonen am besten vorher, dann klappt es beim zweiten Mal schneller.",
    ),
  ]);

  const text = renderText(nachricht, [
    "14 Tage lang haben nicht alle Kontaktpersonen ihren Eintrag bestätigt.",
    `Deshalb haben wir Deine Bewerbung für die Saison ${saisonId} mit allen Angaben gelöscht, wie angekündigt.`,
    "",
    "Solange die Bewerbungsfrist läuft, kann sich Deine Schule neu bewerben.",
    "Frag die Kontaktpersonen am besten vorher, dann klappt es beim zweiten Mal schneller.",
  ]);

  return { subject: `Bewerbung gelöscht: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}

/**
 * What the submitter is told when a contact refuses the seat. `abgelehnt` is composed before that
 * seat's details are cleared, the first name being what the message exists to hand over.
 */
export interface BewerbungAblehnungData {
  saisonId: string;
  rollenText: string;
  abgelehnt: BewerbungSeat;
  fristText: string;
}

/** **The two parts state the same facts**, as in the messages above. */
export function buildBewerbungAblehnungEmail({ saisonId, rollenText, abgelehnt, fristText }: BewerbungAblehnungData): BewerbungEmail {
  const frist = einzeilig(fristText);
  const wer = seatName(abgelehnt);

  const nachricht: Nachricht = {
    headingVor: "Abgelehnt: Eintrag für die",
    saisonId: saisonId,
    empfaenger: "einreichende",
    fakten: [
      { label: "Status", value: "Nicht vollständig, eine Bestätigung fehlt" },
      { label: "Saison", value: saisonId, akzent: true },
      { label: "Eingetragen als", value: rollenText },
      { label: "Abgelehnt von", value: wer },
    ],
    aktionen: neuBewerbenAktionen(saisonId),
    textAktionen: neuBewerbenZeilen(saisonId),
    ignorierSatz: IGNORIER_SATZ_BEWERBUNG,
  };

  const html = renderHtml(nachricht, [
    // No pronoun, and „Diese Angaben“ where „seine“ or „ihre“ would stand: both read correctly for
    // every name (`docs/frontend/spec.md :: 1.12`).
    paragraph(
      `${strong(`${escapeHtml(wer)} hat den Eintrag als Kontaktperson abgelehnt.`)} Diese Angaben haben wir aus der Bewerbung entfernt.`,
    ),
    paragraph(
      `So kann die Bewerbung nicht vollständig werden; am ${strong(escapeHtml(frist))} löschen wir sie. Möchte Deine Schule trotzdem mitspielen, bewirb Dich neu, mit einer anderen Person in dieser Rolle. Frag sie vorher.`,
    ),
  ]);

  const text = renderText(nachricht, [
    `${wer} hat den Eintrag als Kontaktperson abgelehnt. Diese Angaben haben wir aus der Bewerbung entfernt.`,
    "",
    `So kann die Bewerbung nicht vollständig werden; am ${frist} löschen wir sie.`,
    "Möchte Deine Schule trotzdem mitspielen, bewirb Dich neu, mit einer anderen Person in dieser Rolle. Frag sie vorher.",
  ]);

  return { subject: `Eintrag abgelehnt: ${BRAND_NAME}, Saison ${saisonId}`, html: html, text: text };
}
