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
import { ADMINISTRATOREN_TITEL } from "./seitenNamen";

import type { AdresswechselWeg } from "./adresswechsel";
import type { Aktion } from "./emailShell";

/** The one address page, both links' and every record's, under the segment `robots.ts` already turns crawlers back from. */
export const ADRESSWECHSEL_PFAD = "/bestaetigung/adresse";

const ADMINISTRATOREN_PFAD = "/bereich/admin/administratoren";

/**
 * The one spelling of the address page's link, the stop link's too, the page telling them apart by hash.
 * `token`, because `nginx/shared/http.conf :: $credential_free_uri` redacts that name alone.
 */
function adresswechselLink(origin: string, token: string): string {
  return `${origin}${ADRESSWECHSEL_PFAD}?token=${encodeURIComponent(token)}`;
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
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  origin: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  weg: AdresswechselWeg;
  /** The instant the link lapses, as the mint's own transaction set it. */
  gueltigBis: string;
}

/**
 * The link to the new address, asking only whether the mailbox is theirs. It greets nobody: behind a
 * mistyped address its reader is a stranger. It names no record, the change moving every one.
 */
export function buildAdresswechselEmail({ origin, token, weg, gueltigBis }: AdresswechselLinkData): AdresswechselEmail {
  const site = mailOrigin(origin);
  const url = adresswechselLink(site, token);
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

// One subject for every way: the approval's request exists so a real holder can refuse a pretext, and a
// subject telling them to approve would be its first instruction.
const HINWEIS_BETREFF = `Deine E-Mail-Adresse bei der ${BRAND_NAME} soll sich ändern`;

/** What the notice to the address on file is built from. */
export interface AdresswechselHinweisData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  origin: string;
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
export function buildAdresswechselHinweisEmail({ origin, stoppToken, weg, gueltigBis, vorname }: AdresswechselHinweisData): AdresswechselEmail {
  const site = mailOrigin(origin);
  const name = einzeilig(vorname);
  const stopp = adresswechselLink(site, stoppToken);

  const anlass =
    weg === "konto"
      ? "in Deinem Konto wurde eine neue E-Mail-Adresse angegeben. Sie gilt erst, wenn sie über den Link bestätigt ist, den wir an sie geschickt haben. Bis dahin bleibt diese Adresse in Kraft."
      : weg === "freigabe"
        ? "die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen. Sie gilt nur, wenn Du sie in Deinem Konto freigibst. Gib sie nur frei, wenn Du das selbst bei uns angefragt hast."
        : `die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen, weil diese Adresse nicht mehr erreichbar sein soll. Bestätigt die neue Adresse ihren Link, gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} danach.`;
  // The approval is the account page's alone, so `freigabe` names the deadline that page keeps.
  const freigabe = (zeit: string): string => `Freigeben kannst Du sie bis ${zeit}, nachdem Du Dich mit dieser Adresse angemeldet hast.`;
  const bis = adresswechselZeitpunkt(gueltigBis);
  const stoppSatz = "Hast Du das nicht veranlasst? Dann stoppe die Änderung über diesen Link. Er gilt, bis die Änderung wirksam wird.";
  const fragen = (kontakt: string): string => `Fragen jederzeit an ${kontakt}.`;

  // The stop leads on every way: no link approves anything, the account page asking a fresh sign-in first.
  const aktionen: readonly Aktion[] = [
    { href: stopp, label: ADRESSWECHSEL_STOPPEN, ton: "primary" },
    ...(weg === "freigabe" ? [{ href: `${site}${KONTO_HREF}`, label: "Zu Deinem Konto", ton: "outline" } as const] : []),
  ];

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${HINWEIS_BETREFF}`,
    ueberschrift: escapeHtml(HINWEIS_BETREFF),
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
    `${BRAND_NAME}: ${HINWEIS_BETREFF}`,
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
    subject: HINWEIS_BETREFF,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}

const WIRKSAM_BETREFF = `Deine E-Mail-Adresse bei der ${BRAND_NAME} wurde geändert`;

/**
 * The completion notice: no control and no new address, but a way to repudiate the change (NIST SP
 * 800-63B-4, read 2026-10-20: "clear instructions, including contact information").
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

  // Never says the old address stops signing in: a seat not yet confirmed stays behind and still signs in there.
  const gilt = (zeit: string): string =>
    `für Dein Konto bei der ${BRAND_NAME} gilt seit ${zeit} eine neue E-Mail-Adresse. Deine Einträge stehen jetzt unter ihr, und mit ihr meldest Du Dich an.`;
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

const NICHT_WIRKSAM_BETREFF = `Deine E-Mail-Adresse bei der ${BRAND_NAME} wurde nicht geändert`;

/**
 * The new mailbox's notice that a confirmed change did not take effect at its time. No name, no reason:
 * a ban on this very address is among the reasons, and the holder of the address may be a stranger.
 */
export function buildAdresswechselNichtWirksamEmail({ origin }: { origin: string }): AdresswechselEmail {
  const site = mailOrigin(origin);
  const satz = (kontakt: string): string =>
    `die Änderung Deiner E-Mail-Adresse ist nicht wirksam geworden. Wir helfen Dir gern weiter: ${kontakt}`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${NICHT_WIRKSAM_BETREFF}`,
    ueberschrift: escapeHtml(NICHT_WIRKSAM_BETREFF),
    bloecke: [paragraph(`Hallo, ${satz(link(`mailto:${KONTAKT_EMAIL}`, KONTAKT_EMAIL))}`, "0")],
    aktionen: [],
    fuss: `${EMPFAENGER_SATZ} ${ANTWORT_SATZ_HTML}`,
    origin: site,
  });

  const oben = [`${BRAND_NAME}: ${NICHT_WIRKSAM_BETREFF}`, "", `Hallo, ${satz(KONTAKT_EMAIL)}`];

  return {
    subject: NICHT_WIRKSAM_BETREFF,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [EMPFAENGER_SATZ, ANTWORT_SATZ_TEXT])].join("\n"),
  };
}

const GENEHMIGUNG_BETREFF = "Eine Adressänderung wartet auf Deine Genehmigung";

/**
 * Tells another holder of the administration that a grant holder's change waits for an approval. It names no
 * address and no person, and links to the page without an id: whoever reads it signs in to learn the rest.
 */
export function buildAdresswechselGenehmigungEmail({ origin }: { origin: string }): AdresswechselEmail {
  const site = mailOrigin(origin);
  const ziel = `${site}${ADMINISTRATOREN_PFAD}`;
  // Never that the person gave the address: on the lost-mailbox way an administrator typed it.
  const satz =
    "für eine Person mit Zugang zur Verwaltung ist eine neue E-Mail-Adresse eingetragen. Der Zugang wechselt erst zu ihr, wenn die Änderung genehmigt ist.";
  const pruefen = `Prüfe die Änderung unter „${ADMINISTRATOREN_TITEL}“, und genehmige sie nur, wenn Du sicher bist, dass die Person sie selbst angefragt hat.`;

  const html = renderKarte({
    titel: `${BRAND_NAME}: ${GENEHMIGUNG_BETREFF}`,
    ueberschrift: escapeHtml(GENEHMIGUNG_BETREFF),
    bloecke: [paragraph(`Hallo, ${escapeHtml(satz)}`), paragraph(escapeHtml(pruefen), "0")],
    aktionen: [{ href: ziel, label: "Zu den Administratoren", ton: "primary" }],
    fuss: ANTWORT_SATZ_HTML,
    origin: site,
  });

  const oben = [`${BRAND_NAME}: ${GENEHMIGUNG_BETREFF}`, "", `Hallo, ${satz}`, "", pruefen, "", ziel];

  return {
    subject: GENEHMIGUNG_BETREFF,
    html: html,
    text: [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(site, [ANTWORT_SATZ_TEXT])].join("\n"),
  };
}
