import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  art21Satz,
  ASIDE_TEXT,
  BRAND_NAME,
  einzeilig,
  escapeHtml,
  FALLBACK_SATZ,
  fallbackBloecke,
  link,
  mailOrigin,
  paragraph,
  renderKarte,
  strong,
  stuffSignatureDelimiter,
  textFooter,
} from "./emailShell";

import type { Aktion } from "./emailShell";

/** A segment of its own rather than a query on a shared page, so the sitemap and `robots.ts` answer it by name. */
export const SCHIEDSRICHTER_BESTAETIGUNG_PATH = "/bestaetigung/schiedsrichter";

/**
 * The one place the referee's confirmation link is spelled. `token` is the parameter name because
 * `nginx/shared/http.conf :: $credential_free_uri` matches that name; a second spelling reaches the access
 * line and the referer unredacted.
 */
export function schiedsrichterBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${SCHIEDSRICHTER_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}

const UEBERSCHRIFT = "Dein Eintrag als Schiedsrichterin oder Schiedsrichter";

/**
 * For the reader who never agreed to officiate: an administrator typed this address. What ignoring
 * costs differs from every application message — the entry survives the deadline, and only the
 * publication waits on the press.
 */
const ignorierSatz = (kontakt: string): string =>
  `Du weißt nichts von einem Eintrag bei der ${BRAND_NAME}? Dann ignoriere diese E-Mail einfach: Ohne Deine Bestätigung erscheint Dein Name nirgends auf der Website. Sollen wir den Eintrag löschen, schreib uns an ${kontakt}.`;

/** Named per message, as every application close is: a sentence saying who else read this has to be true of it. */
const EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

export type SchiedsrichterEmail = { subject: string; html: string; text: string };

/** What one referee is asked to confirm. No season: a referee's entry is bound to none, so the deadline is the only date here. */
export interface SchiedsrichterBestaetigungData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
  origin: string;
  vorname: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  /**
   * The deadline as a German date, rendered by the caller for the reason
   * `fl_frontend/src/core/bewerbungEmail.ts :: BewerbungBestaetigungData` gives:
   * `fl_frontend/src/shared/utils/format.ts :: formatSpielDatum` sits in a layer `core` may not reach.
   */
  fristText: string;
}

/**
 * One control, as the sign-in message carries one: the message exists for this link alone, and a
 * second destination beside it competes with the one press a reader came for.
 */
function aktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Eintrag bestätigen", ton: "primary" }];
}

function renderHtml(vorname: string, url: string, frist: string, origin: string): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(
        `Hallo ${strong(escapeHtml(vorname))}, die Verwaltung der ${BRAND_NAME} hat Dich als Schiedsrichterin oder Schiedsrichter eingetragen. ${strong("Bitte bestätige, dass das stimmt")}: Erst danach kannst Du auf der Website Ansetzungen annehmen und Spielberichte einreichen.`,
      ),
      // Both answers are named before the press: a reader who came to confirm an entry and meets a
      // publication choice was asked something the message did not say.
      paragraph(
        `Auf der Seite trägst Du Dein Geburtsdatum ein und entscheidest, was im Spielplan von Deinem Namen zu sehen ist. Der Link ist bis zum ${strong(escapeHtml(frist))} gültig und funktioniert nur einmal. Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen.`,
      ),
      // The address as a marked link: one a reader has to select and paste is not a route.
      paragraph(art21Satz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL), { zweck: "für den Spielbetrieb" })),
      ...fallbackBloecke([{ label: "", url: url }], FALLBACK_SATZ),
      // The address as a marked link here too: the escape route is one a reader has to select and paste otherwise.
      paragraph(ignorierSatz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(url),
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: origin,
  });
}

function renderText(vorname: string, url: string, frist: string, origin: string): string {
  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT}`,
    "",
    `Hallo ${vorname}, die Verwaltung der ${BRAND_NAME} hat Dich als Schiedsrichterin oder Schiedsrichter eingetragen.`,
    "Bitte bestätige, dass das stimmt: Erst danach kannst Du auf der Website Ansetzungen annehmen und Spielberichte einreichen.",
    "",
    "Auf der Seite trägst Du Dein Geburtsdatum ein und entscheidest, was im Spielplan von Deinem Namen zu sehen ist.",
    `Der Link ist bis zum ${frist} gültig und funktioniert nur einmal.`,
    "Ist er abgelaufen, schickt die Verwaltung Dir auf Wunsch einen neuen.",
    "",
    art21Satz(KONTAKT_EMAIL, { zweck: "für den Spielbetrieb" }),
    "",
    url,
    "",
    ignorierSatz(KONTAKT_EMAIL),
  ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts**, as in the application messages
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungBestaetigungEmail`).
 */
export function buildSchiedsrichterBestaetigungEmail({
  origin,
  vorname,
  token,
  fristText,
}: SchiedsrichterBestaetigungData): SchiedsrichterEmail {
  const site = mailOrigin(origin);
  // Folded before either branch: this message renders no fact panel, so nothing downstream would
  // fold these, and the two halves have to state one string.
  const name = einzeilig(vorname);
  const frist = einzeilig(fristText);
  const url = schiedsrichterBestaetigungsLink(site, token);

  return {
    subject: `Bitte bestätigen: Dein Eintrag bei der ${BRAND_NAME}`,
    html: renderHtml(name, url, frist, site),
    text: renderText(name, url, frist, site),
  };
}

/** The address page's own segment, under the one `robots.ts` already turns crawlers back from. */
export const SCHIEDSRICHTER_ADRESSWECHSEL_PATH = "/bestaetigung/schiedsrichter/adresse";

/** The one place the address link is spelled, its parameter named `token` for `schiedsrichterBestaetigungsLink`'s reason. */
export function schiedsrichterAdresswechselLink(origin: string, token: string): string {
  return `${origin}${SCHIEDSRICHTER_ADRESSWECHSEL_PATH}?token=${encodeURIComponent(token)}`;
}

const ADRESSE_UEBERSCHRIFT = "Neue E-Mail-Adresse bestätigen";

/** What an address link mail is built from; `fristText` is rendered by the caller for `SchiedsrichterBestaetigungData`'s reason. */
export interface SchiedsrichterAdresswechselData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
  origin: string;
  vorname: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  fristText: string;
}

// For the holder of a mailbox an administrator mistyped. No „ignoriere“: ignoring leaves the address
// stored, and the page takes the decline past the link's deadline too.
const adresseIgnorierSatz =
  "Ist das nicht Deine Adresse? Dann wähle auf der Seite „Das ist nicht meine Adresse“, auch wenn der Link schon abgelaufen ist; wir entfernen sie dann sofort.";

/**
 * The link to a confirmed referee's new address. It asks nothing but whether the mailbox is theirs:
 * their consent stands, and a page asking it again would record an answer nobody owed.
 */
export function buildSchiedsrichterAdresswechselEmail({
  origin,
  vorname,
  token,
  fristText,
}: SchiedsrichterAdresswechselData): SchiedsrichterEmail {
  const site = mailOrigin(origin);
  // Folded before either branch, for `buildSchiedsrichterBestaetigungEmail`'s reason.
  const name = einzeilig(vorname);
  const frist = einzeilig(fristText);
  const url = schiedsrichterAdresswechselLink(site, token);

  const eintrag = `die Verwaltung der ${BRAND_NAME} hat für Deinen Eintrag als Schiedsrichterin oder Schiedsrichter diese E-Mail-Adresse eingetragen.`;
  const gilt = "Sie gilt erst, wenn Du sie bestätigst; bis dahin schreiben wir an Deine bisherige Adresse.";

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${ADRESSE_UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(ADRESSE_UEBERSCHRIFT),
    bloecke: [
      paragraph(`Hallo ${strong(escapeHtml(name))}, ${eintrag} ${strong(escapeHtml(gilt))}`),
      paragraph(`Bestätige sie bis zum ${strong(escapeHtml(frist))} über diesen Link. Er funktioniert nur einmal.`),
      ...fallbackBloecke([{ label: "", url: url }], FALLBACK_SATZ),
      paragraph(escapeHtml(adresseIgnorierSatz), "0", ASIDE_TEXT),
    ],
    aktionen: [{ href: url, label: "Adresse bestätigen", ton: "primary" }],
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [
    `${BRAND_NAME}: ${ADRESSE_UEBERSCHRIFT}`,
    "",
    `Hallo ${name}, ${eintrag}`,
    gilt,
    "",
    `Bestätige sie bis zum ${frist} über diesen Link. Er funktioniert nur einmal.`,
    "",
    url,
    "",
    adresseIgnorierSatz,
  ];

  return {
    subject: ADRESSE_UEBERSCHRIFT,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}

const HINWEIS_BETREFF = `Deine E-Mail-Adresse bei der ${BRAND_NAME} soll sich ändern`;

/**
 * The notice to the address still holding the record. It names no new address: the change may be
 * somebody else's mistake, and this mailbox is the one owed the word, never the other mailbox's name.
 */
export function buildSchiedsrichterAdresswechselHinweisEmail({ origin, vorname }: { origin: string; vorname: string }): SchiedsrichterEmail {
  const site = mailOrigin(origin);
  const name = einzeilig(vorname);

  const eingetragen = "die Verwaltung hat für Deinen Eintrag als Schiedsrichterin oder Schiedsrichter eine neue E-Mail-Adresse eingetragen.";
  const gilt = "Sie gilt erst, wenn sie über den Link bestätigt ist, den wir an sie geschickt haben; bis dahin bleibt diese Adresse in Kraft.";
  const nichtVeranlasst = (kontakt: string): string => `Hast Du das nicht veranlasst, schreib uns an ${kontakt}.`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${HINWEIS_BETREFF}`,
    ueberschrift: escapeHtml(HINWEIS_BETREFF),
    bloecke: [
      paragraph(`Hallo ${strong(escapeHtml(name))}, ${eingetragen} ${gilt}`),
      // The address as a marked link, for the consent mail's reason.
      paragraph(nichtVeranlasst(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL))),
    ],
    aktionen: [],
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [`${BRAND_NAME}: ${HINWEIS_BETREFF}`, "", `Hallo ${name}, ${eingetragen}`, gilt, "", nichtVeranlasst(KONTAKT_EMAIL)];

  return {
    subject: HINWEIS_BETREFF,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}
