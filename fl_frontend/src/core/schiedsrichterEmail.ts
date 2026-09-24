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

// Spelled here as well as in `fl_frontend/src/core/authEmail.ts :: FALLBACK_SATZ`: one situation
// reads as one sentence to the person meeting it, so the two move together.
const FALLBACK_SATZ = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";

/** Named per message, as every application close is: a sentence saying who else read this has to be true of it. */
const EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

// A paragraph and a line group of its own: Art. 21(4) DSGVO asks the objection to reach a person at
// the first contact, apart from every other piece of information.
const art21Satz = (adresse: string): string =>
  `Der Verarbeitung Deiner Angaben für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation ergeben (Art. 21 DSGVO); eine formlose E-Mail an ${adresse} genügt.`;

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
 * One line, whatever was typed. The text branch is line-oriented, so a break here is its injection:
 * the value would render a line the reader cannot tell from the facts around it.
 */
function einzeilig(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
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
      paragraph(art21Satz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL))),
      paragraph(FALLBACK_SATZ, "0 0 8px", ASIDE_TEXT),
      /* The link runs past the card's width, so this one paragraph breaks inside a word. Marked as a
         link as well: an address a reader has to select and paste is not a route. */
      paragraph(link(url, url), "0 0 16px", `${ASIDE_TEXT}word-break:break-all;`),
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
    art21Satz(KONTAKT_EMAIL),
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
