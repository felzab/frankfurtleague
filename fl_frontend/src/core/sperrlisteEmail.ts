import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  escapeHtml,
  link,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

export type SperrlisteEmail = { subject: string; html: string; text: string };

const UEBERSCHRIFT = "Deine E-Mail-Adresse ist gesperrt";

/**
 * The one control, and the only step this message asks for. Every other league message offers a
 * page; a reader barred from signing up has none to be sent to.
 */
const FRAGE_LABEL = "Frage stellen";

/**
 * The ruled fragment, which says INCLUSIVE where a bare „bis“ does not: a reader told the ban ends
 * „bis 2031“ reads the whole of that season as free.
 */
function bisSatz(gesperrtBisSaisonId: string): string {
  return `Die Sperre gilt bis einschließlich der Saison ${gesperrtBisSaisonId}.`;
}

const GRUND_VOR = "Angegebener Grund:";

/**
 * What the row keeps, named because the reader cannot be shown it: the address itself is stored
 * nowhere, so nobody can hand it back and this sentence is the only account of the record.
 */
const GESPEICHERT_SATZ =
  "Gespeichert sind ein Fingerabdruck Deiner Adresse, der Grund, das Datum und wer die Sperre eingetragen hat. Deine Adresse selbst speichern wir nicht.";

/**
 * Art. 6 (1) (f). Named because the mail is the ONLY record this reader ever gets: the notice they
 * would otherwise read it in is a page nobody has sent them to.
 */
const GRUNDLAGE_SATZ =
  "Wir speichern diesen Eintrag auf Grundlage unseres berechtigten Interesses daran, eine gesperrte Adresse nicht erneut zuzulassen (Art. 6 Abs. 1 lit. f DSGVO).";

/**
 * Art. 21 (4) asks that the right to object be brought to the reader's attention EXPLICITLY and
 * SEPARATELY at the first communication, which this message is.
 */
const widerspruchSatz = (kontakt: string): string =>
  `Du kannst dieser Speicherung nach Art. 21 DSGVO widersprechen. Schreib uns dafür an ${kontakt}; dort beantworten wir auch Fragen zur Sperre.`;

// Every refusal the ban reaches, in one sentence: a sign-in, a registration, a contact seat on an
// application and a referee's entry. „anmelden“ is the SIGN-IN's verb and „registrieren“ the season's.
const EINLEITUNG = `Deine E-Mail-Adresse wurde von der Verwaltung der ${BRAND_NAME} gesperrt. Mit ihr kannst Du Dich vorerst weder anmelden noch für eine Saison registrieren, und Du kannst weder als Kontaktperson in einer Bewerbung genannt noch als Schiedsrichterin oder Schiedsrichter eingetragen werden.`;

// „werden beendet“: the mail leaves after the sign-out was attempted and cannot know whether it held,
// a failure being the administrator's to read.
const ANMELDUNGEN_SATZ =
  "Bestehende Anmeldungen mit dieser Adresse werden beendet. Dein Zugang bleibt erhalten und funktioniert wieder, sobald die Sperre endet.";

/** What the form's hint promises the mail explains, so the two say one thing. */
const LAPSE_SATZ = "Danach endet die Sperre von selbst; Du musst dafür nichts tun.";

function aktionen(): readonly Aktion[] {
  return [{ href: `mailto:${KONTAKT_EMAIL}`, label: FRAGE_LABEL, ton: "primary" }];
}

function renderHtml(grund: string, gesperrtBisSaisonId: string, origin: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      // The bound is emphasised inside the prose rather than panelled: a card of one fact beside a
      // heading naming the ban reads as a certificate of it.
      paragraph(
        `${escapeHtml(EINLEITUNG)} ${escapeHtml(ANMELDUNGEN_SATZ)} ${strong(escapeHtml(bisSatz(gesperrtBisSaisonId)))} ${escapeHtml(LAPSE_SATZ)}`,
      ),
      paragraph(`${GRUND_VOR} ${escapeHtml(grund)}`),
      paragraph(escapeHtml(GESPEICHERT_SATZ), "0 0 16px", ASIDE_TEXT),
      paragraph(escapeHtml(GRUNDLAGE_SATZ), "0 0 16px", ASIDE_TEXT),
      // Its own paragraph and the last before the control, which is the separateness Art. 21 (4) asks for.
      // The address as a marked link here too: the objection is one a reader has to select and paste otherwise.
      paragraph(widerspruchSatz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(),
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });
}

function renderText(grund: string, gesperrtBisSaisonId: string, origin: string): string {
  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    "",
    `${EINLEITUNG} ${ANMELDUNGEN_SATZ} ${bisSatz(gesperrtBisSaisonId)} ${LAPSE_SATZ}`,
    "",
    `${GRUND_VOR} ${grund}`,
    "",
    GESPEICHERT_SATZ,
    "",
    GRUNDLAGE_SATZ,
    "",
    widerspruchSatz(KONTAKT_EMAIL),
  ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`).
 */
export function buildSperreEmail({
  grund,
  gesperrtBisSaisonId,
  origin,
}: {
  grund: string;
  gesperrtBisSaisonId: string;
  origin: string;
}): SperrlisteEmail {
  const site = mailOrigin(origin);

  return {
    subject: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    html: renderHtml(grund, gesperrtBisSaisonId, site),
    text: renderText(grund, gesperrtBisSaisonId, site),
  };
}
