import "server-only";

import { ADRESSWECHSEL_WARTEZEIT_DAUER, adresswechselZeitpunkt } from "./adresswechsel";
import { ADRESSWECHSEL_STOPPEN, NICHT_MEINE_ADRESSE } from "./adresswechselAntworten";
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
import { KONTO_HREF } from "./kontoHref";

import type { AdresswechselArt, AdresswechselWeg } from "./adresswechsel";
import type { Aktion } from "./emailShell";

/** Each lane's address page, under the segment `robots.ts` already turns crawlers back from. */
const ADRESSWECHSEL_PFAD: Readonly<Record<AdresswechselArt, string>> = {
  spieler: "/bestaetigung/spieler/adresse",
  schiedsrichter: "/bestaetigung/schiedsrichter/adresse",
};

/**
 * The one place an address page's link is spelled, the new mailbox's and the stop link alike: one page
 * tells the two apart by which hash the token matches. `token` is the parameter name because
 * `nginx/shared/http.conf :: $credential_free_uri` matches that name; a second spelling reaches the
 * access line and the referer unredacted.
 */
export function adresswechselLink(origin: string, art: AdresswechselArt, token: string): string {
  return `${origin}${ADRESSWECHSEL_PFAD[art]}?token=${encodeURIComponent(token)}`;
}

export type AdresswechselEmail = { subject: string; html: string; text: string };

/** Named per message, as every application close is: a sentence saying who else read this has to be true of it. */
const EMPFAENGER_SATZ = "Diese E-Mail geht nur an Dich.";

/** A referee row may hold no name to cut a first name from, and a greeting naming nobody reads as a slip. */
const gruss = (vorname: string): string => (vorname === "" ? "Hallo," : `Hallo ${vorname},`);

const ADRESSE_UEBERSCHRIFT = "Neue E-Mail-Adresse bestätigen";

// For the holder of a mailbox somebody mistyped. No promise of a decline after the lapse: the hourly
// pass removes the change, its link and the decline with it.
const adresseIgnorierSatz = `Ist das nicht Deine Adresse? Dann wähle auf der Seite „${NICHT_MEINE_ADRESSE}“. Wir entfernen sie dann sofort. Tust Du nichts, löschen wir sie, sobald der Link abgelaufen ist.`;

/** What the link to the new address is built from. */
export interface AdresswechselLinkData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
  origin: string;
  /** The lane carrying the change, whose page alone finds the token. */
  art: AdresswechselArt;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  weg: AdresswechselWeg;
  /** The instant the link lapses, as the mint's own transaction set it. */
  gueltigBis: string;
}

/**
 * The link to the new address. It asks nothing but whether the mailbox is theirs, and greets nobody by
 * name: this mailbox has proved nothing yet, and behind a mistyped address it is a stranger's. It
 * names no lane, since the change moves every record the address holds.
 */
export function buildAdresswechselEmail({ origin, art, token, weg, gueltigBis }: AdresswechselLinkData): AdresswechselEmail {
  const site = mailOrigin(origin);
  const url = adresswechselLink(site, art, token);
  const bis = adresswechselZeitpunkt(gueltigBis);

  // The person typed it on the person's own start; the administration on either of its two.
  const eintrag =
    weg === "konto"
      ? `für ein Konto bei der ${BRAND_NAME} wurde diese E-Mail-Adresse als neue angegeben.`
      : `die Verwaltung der ${BRAND_NAME} hat diese E-Mail-Adresse für ein Konto eingetragen.`;
  const gilt = "Sie gilt erst, wenn Du sie bestätigst. Bis dahin schreiben wir an die bisherige Adresse.";
  const frist = (zeit: string): string => `Bestätige sie bis ${zeit} über diesen Link. Er funktioniert nur einmal.`;
  const wartezeit = weg === "wartezeit" ? `Nach Deiner Bestätigung gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} später.` : null;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${ADRESSE_UEBERSCHRIFT}`,
    ueberschrift: escapeHtml(ADRESSE_UEBERSCHRIFT),
    bloecke: [
      paragraph(`Hallo, ${eintrag} ${strong(escapeHtml(gilt))}`),
      paragraph(`${frist(strong(escapeHtml(bis)))}${wartezeit === null ? "" : ` ${wartezeit}`}`),
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
    frist(bis),
    ...(wartezeit === null ? [] : [wartezeit]),
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
const FREIGABE_BETREFF = "Gib die neue E-Mail-Adresse frei";

/** What the notice to the address on file is built from. */
export interface AdresswechselHinweisData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL` (`docs/frontend/spec.md :: I186`). */
  origin: string;
  art: AdresswechselArt;
  /** The raw stop token, a bearer credential like the link's. */
  stoppToken: string;
  weg: AdresswechselWeg;
  /** The approval's deadline, which only `freigabe`'s notice states: the stop link outlives it. */
  gueltigBis: string;
  vorname: string;
}

/**
 * The notice to the address on file, carrying its stop link. It names no new address: the change may be
 * somebody else's mistake or a pretext, and this mailbox is owed the word, never the other mailbox's name.
 */
export function buildAdresswechselHinweisEmail({
  origin,
  art,
  stoppToken,
  weg,
  gueltigBis,
  vorname,
}: AdresswechselHinweisData): AdresswechselEmail {
  const site = mailOrigin(origin);
  const name = einzeilig(vorname);
  const stopp = adresswechselLink(site, art, stoppToken);
  const betreff = weg === "freigabe" ? FREIGABE_BETREFF : HINWEIS_BETREFF;

  const anlass =
    weg === "konto"
      ? "in Deinem Konto wurde eine neue E-Mail-Adresse angegeben. Sie gilt erst, wenn sie über den Link bestätigt ist, den wir an sie geschickt haben. Bis dahin bleibt diese Adresse in Kraft."
      : weg === "freigabe"
        ? "die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen. Sie gilt erst, wenn Du sie freigibst:"
        : `die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen, weil diese Adresse nicht mehr erreichbar sein soll. Bestätigt die neue Adresse ihren Link, gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} danach.`;
  // The approval is the account page's alone, so `freigabe` names the deadline that page keeps.
  const freigabe = (zeit: string): string => `Melde Dich bis ${zeit} mit dieser Adresse an und gib sie in Deinem Konto frei.`;
  const bis = adresswechselZeitpunkt(gueltigBis);
  const stoppSatz = "Hast Du das nicht veranlasst? Dann stoppe die Änderung über diesen Link. Er gilt, bis die Änderung wirksam wird.";
  const fragen = (kontakt: string): string => `Fragen jederzeit an ${kontakt}.`;

  // No link approves anything: the account page asks a fresh sign-in first, so its control carries no token.
  const aktionen: readonly Aktion[] = [
    ...(weg === "freigabe" ? [{ href: `${site}${KONTO_HREF}`, label: "Zu Deinem Konto", ton: "primary" } as const] : []),
    { href: stopp, label: ADRESSWECHSEL_STOPPEN, ton: weg === "freigabe" ? "outline" : "primary" },
  ];

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${betreff}`,
    ueberschrift: escapeHtml(betreff),
    bloecke: [
      paragraph(
        `${name === "" ? "Hallo," : `Hallo ${strong(escapeHtml(name))},`} ${escapeHtml(anlass)}${weg === "freigabe" ? ` ${freigabe(strong(escapeHtml(bis)))}` : ""}`,
      ),
      paragraph(escapeHtml(stoppSatz)),
      ...fallbackBloecke([{ label: "", url: stopp }], FALLBACK_SATZ),
      // The address as a marked link: one a reader has to select and paste is not a route.
      paragraph(fragen(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0", ASIDE_TEXT),
    ],
    aktionen: aktionen,
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [
    `${BRAND_NAME}: ${betreff}`,
    "",
    `${gruss(name)} ${anlass}`,
    ...(weg === "freigabe" ? [freigabe(bis), `Zu Deinem Konto: ${site}${KONTO_HREF}`] : []),
    "",
    stoppSatz,
    "",
    stopp,
    "",
    fragen(KONTAKT_EMAIL),
  ];

  return {
    subject: betreff,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}

const WIRKSAM_BETREFF = `Deine E-Mail-Adresse bei der ${BRAND_NAME} wurde geändert`;

/**
 * The completion notice to the replaced address. No control and no new address: the change is done, and
 * a reader who repudiates it is owed a way to say so (NIST SP 800-63B-4, read 2026-10-20: "clear
 * instructions, including contact information, in case the recipient repudiates the event").
 */
export function buildAdresswechselWirksamEmail({
  origin,
  vorname,
  zeitpunkt,
}: {
  origin: string;
  vorname: string;
  zeitpunkt: Date;
}): AdresswechselEmail {
  const site = mailOrigin(origin);
  const name = einzeilig(vorname);
  const seit = adresswechselZeitpunkt(zeitpunkt);

  const gilt = (zeit: string): string =>
    `für Dein Konto bei der ${BRAND_NAME} gilt seit ${zeit} eine neue E-Mail-Adresse. Diese Adresse erreicht Deine Einträge nicht mehr, und Du meldest Dich mit ihr nicht mehr an.`;
  const nichtVeranlasst = (kontakt: string): string => `Hast Du das nicht veranlasst? Schreib uns sofort an ${kontakt}.`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${WIRKSAM_BETREFF}`,
    ueberschrift: escapeHtml(WIRKSAM_BETREFF),
    bloecke: [
      paragraph(`${name === "" ? "Hallo," : `Hallo ${strong(escapeHtml(name))},`} ${gilt(strong(escapeHtml(seit)))}`),
      paragraph(nichtVeranlasst(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL)), "0"),
    ],
    aktionen: [],
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [`${BRAND_NAME}: ${WIRKSAM_BETREFF}`, "", `${gruss(name)} ${gilt(seit)}`, "", nichtVeranlasst(KONTAKT_EMAIL)];

  return {
    subject: WIRKSAM_BETREFF,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}
