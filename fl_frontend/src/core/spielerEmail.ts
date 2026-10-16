import "server-only";

import { KONTAKT_EMAIL } from "./brand";
import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
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

/** The pupil's address page, under the segment `robots.ts` already turns crawlers back from. */
export const SPIELER_ADRESSWECHSEL_PATH = "/bestaetigung/spieler/adresse";

/**
 * The one place the pupil's address link is spelled. `token` is the parameter name because
 * `nginx/shared/http.conf :: $credential_free_uri` matches that name; a second spelling reaches the
 * access line and the referer unredacted.
 */
export function spielerAdresswechselLink(origin: string, token: string): string {
  return `${origin}${SPIELER_ADRESSWECHSEL_PATH}?token=${encodeURIComponent(token)}`;
}

export type SpielerEmail = { subject: string; html: string; text: string };

/** What the address link mail is built from. */
export interface SpielerAdresswechselData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
  origin: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  /**
   * The deadline as a German date, rendered by the caller: `fl_frontend/src/shared/utils/format.ts ::
   * formatSpielDatum` sits in a layer `core` may not reach.
   */
  fristText: string;
}

/** Named per message, as every application close is: a sentence saying who else read this has to be true of it. */
const EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

const ADRESSE_UEBERSCHRIFT = "Neue E-Mail-Adresse bestätigen";

// For the holder of a mailbox an administrator mistyped. No promise of a decline after the lapse: the
// day after it, the lapse removes the change, its link and the decline with it.
const adresseIgnorierSatz =
  "Ist das nicht Deine Adresse? Dann wähle auf der Seite „Das ist nicht meine Adresse“. Wir entfernen sie dann sofort. Tust Du nichts, löschen wir sie am Tag nach Ablauf des Links.";

/**
 * The link to a pupil's new address, the referee's twin
 * (`fl_frontend/src/core/schiedsrichterEmail.ts :: buildSchiedsrichterAdresswechselEmail`) but for its
 * greeting. It asks nothing but whether the mailbox is theirs: their consent stands, and asking it
 * again records an answer nobody owed.
 */
export function buildSpielerAdresswechselEmail({ origin, token, fristText }: SpielerAdresswechselData): SpielerEmail {
  const site = mailOrigin(origin);
  // Folded before either branch: this message renders no fact panel, and the two halves state one string.
  const frist = einzeilig(fristText);
  const url = spielerAdresswechselLink(site, token);

  // Greets nobody by name, unlike the referee's: this mailbox has proved nothing yet, and behind a
  // mistyped address it is a stranger's, who is owed no minor's first name. The notice keeps the name.
  const eintrag = `die Verwaltung der ${BRAND_NAME} hat für Deinen Eintrag als Spielerin oder Spieler diese E-Mail-Adresse eingetragen.`;
  const gilt = "Sie gilt erst, wenn Du sie bestätigst. Bis dahin schreiben wir an Deine bisherige Adresse.";

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${ADRESSE_UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(ADRESSE_UEBERSCHRIFT),
    bloecke: [
      paragraph(`Hallo, ${eintrag} ${strong(escapeHtml(gilt))}`),
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
    `Hallo, ${eintrag}`,
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
 * somebody else's mistake, and this mailbox is owed the word, never the other mailbox's name.
 */
export function buildSpielerAdresswechselHinweisEmail({ origin, vorname }: { origin: string; vorname: string }): SpielerEmail {
  const site = mailOrigin(origin);
  const name = einzeilig(vorname);

  const eingetragen = "die Verwaltung hat für Deinen Eintrag als Spielerin oder Spieler eine neue E-Mail-Adresse eingetragen.";
  const gilt = "Sie gilt erst, wenn sie über den Link bestätigt ist, den wir an sie geschickt haben. Bis dahin bleibt diese Adresse in Kraft.";
  const nichtVeranlasst = (kontakt: string): string => `Hast Du das nicht veranlasst, schreib uns an ${kontakt}.`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${HINWEIS_BETREFF}`,
    ueberschrift: escapeHtml(HINWEIS_BETREFF),
    bloecke: [
      paragraph(`Hallo ${strong(escapeHtml(name))}, ${eingetragen} ${gilt}`),
      // The address as a marked link: one a reader has to select and paste is not a route.
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
