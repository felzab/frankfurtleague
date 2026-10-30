import "server-only";

import { ADRESSWECHSEL_WARTEZEIT_DAUER } from "./adresswechsel";
import { ADRESSWECHSEL_STOPPEN } from "./adresswechselAntworten";
import { KONTAKT_EMAIL } from "./brand";
import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatInstant } from "./format";

import type { Mail, Paragraph } from "./emailShell";
import type {
  FLAddressChangeDiscardedData,
  FLAddressChangeEffectiveData,
  FLAddressChangeHinweisData,
  FLAddressChangeLinkData,
  FLAddressChangeWay,
} from "./generated/client/types";
import type { MailLink, MailOrt } from "./mailKinds";

/** The one address page, both links' and every record's, under the segment `robots.ts` already turns crawlers back from. */
export const ADRESSWECHSEL_PFAD = "/bestaetigung/adresse";

/**
 * The one spelling of the address page's link, the stop link's too, the page telling them apart by hash.
 * `token`, because `nginx/shared/http.conf :: $credential_free_uri` redacts that name alone.
 */
function adresswechselLink(origin: string, token: string): string {
  return `${origin}${ADRESSWECHSEL_PFAD}?token=${encodeURIComponent(token)}`;
}

/**
 * The link to the new address, asking only whether the mailbox is theirs. It greets nobody: behind a
 * mistyped address its reader is a stranger. It names no record, the change moving every one.
 */
export function buildAdresswechselEmail({ way: weg, valid_until: gueltigBis }: FLAddressChangeLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  return {
    art: "sicherheit",
    subjectLine: "Neue E-Mail-Adresse bestätigen",
    origin: site,
    vorname: "",
    paragraphs: [
      [
        // The person typed it on the person's own start; the administration on either of its two.
        weg === "account"
          ? `Für ein Konto bei der ${BRAND_NAME} wurde diese E-Mail-Adresse als neue angegeben.`
          : `Die Verwaltung der ${BRAND_NAME} hat diese E-Mail-Adresse für ein Konto eingetragen.`,
        [{ strong: "Sie gilt erst, wenn Du sie bestätigst. Bis dahin schreiben wir an die bisherige Adresse." }],
      ],
      [
        ["Bestätige sie bis ", { strong: formatInstant(gueltigBis) }, " über diesen Link."],
        "Er funktioniert nur einmal.",
        ...(weg === "waiting_period" ? [`Nach Deiner Bestätigung gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} später.`] : []),
      ],
    ],
    button: { label: "Adresse bestätigen", href: adresswechselLink(site, token) },
  };
}

/** Why the address on file is told, per way the change was started. */
function anlassAbsatz(weg: FLAddressChangeWay, gueltigBis: string): Paragraph {
  switch (weg) {
    case "account":
      return [
        "In Deinem Konto wurde eine neue E-Mail-Adresse angegeben.",
        "Sie gilt erst, wenn sie über den Link bestätigt ist, den wir an sie geschickt haben.",
        "Bis dahin bleibt diese Adresse in Kraft.",
      ];
    case "release":
      return [
        "Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen.",
        "Sie gilt nur, wenn Du sie in Deinem Konto freigibst.",
        "Gib sie nur frei, wenn Du das selbst bei uns angefragt hast.",
        // The approval is the account page's alone, so `freigabe` names the deadline that page keeps.
        ["Freigeben kannst Du sie bis ", { strong: formatInstant(gueltigBis) }, ", nachdem Du Dich mit dieser Adresse angemeldet hast."],
      ];
    case "waiting_period":
      return [
        "Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen, weil diese Adresse nicht mehr erreichbar sein soll.",
        `Bestätigt die neue Adresse ihren Link, gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} danach.`,
      ];
  }
}

/**
 * The notice to the address on file, carrying its stop link. It names no new address: the change may be
 * somebody else's mistake or a pretext, and this mailbox is owed the word, never the other mailbox's name.
 */
export function buildAdresswechselHinweisEmail(
  { way: weg, valid_until: gueltigBis, vorname }: FLAddressChangeHinweisData,
  { origin, token: stoppToken }: MailLink,
): Mail {
  const site = mailOrigin(origin);

  return {
    art: "sicherheit",
    // One subject for every way: the approval's request exists so a real holder can refuse a pretext, and a
    // subject telling them to approve would be its first instruction.
    subjectLine: "Deine E-Mail-Adresse soll sich ändern",
    origin: site,
    vorname: vorname ?? "",
    paragraphs: [
      anlassAbsatz(weg, gueltigBis),
      ["Hast Du das nicht veranlasst? Dann stoppe die Änderung über diesen Link.", "Er gilt, bis die Änderung wirksam wird."],
      [["Fragen jederzeit an ", { adresse: KONTAKT_EMAIL }, "."]],
    ],
    // The stop on every way: no link approves anything, the account page asking a fresh sign-in first.
    button: { label: ADRESSWECHSEL_STOPPEN, href: adresswechselLink(site, stoppToken) },
  };
}

/**
 * The completion notice: no control and no new address. The way to repudiate the change (NIST SP 800-63B-4,
 * read 2026-10-20: "clear instructions, including contact information") is the security kind's own last line.
 */
export function buildAdresswechselWirksamEmail({ vorname, instant: zeitpunkt }: FLAddressChangeEffectiveData, { origin }: MailOrt): Mail {
  return {
    art: "sicherheit",
    subjectLine: "Deine E-Mail-Adresse wurde geändert",
    origin: mailOrigin(origin),
    vorname: vorname ?? "",
    paragraphs: [
      [
        ["Für Dein Konto bei der ", BRAND_NAME, " gilt seit ", { strong: formatInstant(zeitpunkt) }, " eine neue E-Mail-Adresse."],
        // Never says the old address stops signing in: a seat not yet confirmed stays behind and still signs in there.
        "Deine Einträge stehen jetzt unter ihr, und mit ihr meldest Du Dich an.",
      ],
    ],
  };
}

/**
 * The new mailbox's notice that a confirmed change did not take effect at its time. No name, no reason:
 * a ban on this very address is among the reasons, and the holder of the address may be a stranger.
 */
export function buildAdresswechselNichtWirksamEmail(_daten: FLAddressChangeDiscardedData, { origin }: MailOrt): Mail {
  return {
    art: "sicherheit",
    subjectLine: "Deine E-Mail-Adresse wurde nicht geändert",
    origin: mailOrigin(origin),
    vorname: "",
    paragraphs: [
      ["Die Änderung Deiner E-Mail-Adresse ist nicht wirksam geworden.", ["Wir helfen Dir gern weiter: ", { adresse: KONTAKT_EMAIL }]],
    ],
  };
}
