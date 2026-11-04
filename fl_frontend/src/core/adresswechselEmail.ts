import "server-only";

import { ADRESSWECHSEL_GUELTIG_STUNDEN, ADRESSWECHSEL_WARTEZEIT_DAUER } from "./adresswechsel";
import { ADRESSWECHSEL_STOPPEN } from "./adresswechselAntworten";
import { KONTAKT_EMAIL } from "./brand";
import { COPY } from "./copy";
import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatInstant } from "./format";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type {
  FLAddressChangeDiscardedData,
  FLAddressChangeEffectiveData,
  FLAddressChangeLinkData,
  FLAddressChangeNoticeData,
} from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

/** The one address page, both links' and every record's, under the segment `robots.ts` already turns crawlers back from. */
const ADRESSWECHSEL_PFAD = "/confirm/address";

/**
 * The one spelling of the address page's link, the stop link's too, the page telling them apart by hash.
 * `token`, because `nginx/shared/http.conf :: $credential_free_uri` redacts that name alone.
 */
function adresswechselLink(origin: string, token: string): string {
  return `${origin}${ADRESSWECHSEL_PFAD}?token=${encodeURIComponent(token)}`;
}

const WORDS = SERVER_COPY.addressChange;

/** Both mails of the person's own change state the link's lifetime, which the backend refuses past. */
const LINK_VALID: Paragraph = [SERVER_COPY.mail.linkValidFor(ADRESSWECHSEL_GUELTIG_STUNDEN)];

/**
 * The link to the new address, asking only whether the mailbox is theirs. It greets nobody: behind a
 * mistyped address its reader is a stranger. It names no record, the change moving every one.
 */
export function buildAdresswechselEmail({ way: weg, valid_until: gueltigBis }: FLAddressChangeLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  // The person's own change, the address on file having confirmed it first: the page's question, its title the button.
  if (weg === "account") {
    return {
      kind: "security",
      subjectLine: COPY.shared.withObject(WORDS.newAddress, "confirm"),
      origin: site,
      vorname: "",
      paragraphs: [[WORDS.new.question], LINK_VALID],
      button: { label: COPY.shared.withObject(COPY.signIn.address, "confirm"), href: adresswechselLink(site, token) },
    };
  }

  // Session 7: the administrator's way takes its final words.
  return {
    kind: "security",
    subjectLine: "Neue E-Mail-Adresse bestätigen",
    origin: site,
    vorname: "",
    paragraphs: [
      [
        `Die Verwaltung der ${BRAND_NAME} hat diese E-Mail-Adresse für ein Konto eingetragen.`,
        [{ strong: "Sie gilt erst, wenn Du sie bestätigst. Bis dahin schreiben wir an die bisherige Adresse." }],
      ],
      [
        ["Bestätige sie bis ", { strong: formatInstant(gueltigBis) }, " über diesen Link."],
        "Er funktioniert nur einmal.",
        `Nach Deiner Bestätigung gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} später.`,
      ],
    ],
    button: { label: "Adresse bestätigen", href: adresswechselLink(site, token) },
  };
}

/**
 * The mail to the address on file. It names no new address, which the page its link opens shows: the change may be
 * somebody else's mistake or a pretext, and a mail travels further than the page it links.
 */
export function buildAdresswechselHinweisEmail(
  { way: weg, vorname }: FLAddressChangeNoticeData,
  { origin, token: stoppToken }: MailLink,
): Mail {
  const site = mailOrigin(origin);

  // The person's own change asks the address on file first: its link confirms or declines the change.
  if (weg === "account") {
    return {
      kind: "security",
      subjectLine: COPY.page.addressChangeConfirmation,
      origin: site,
      vorname: vorname ?? "",
      paragraphs: [[WORDS.previous.question, SERVER_COPY.mail.addressChange.previousEffect], LINK_VALID],
      button: { label: COPY.shared.withObject(WORDS.change, "confirm"), href: adresswechselLink(site, stoppToken) },
    };
  }

  // Session 7: the administrators' lost-mailbox change takes its final words.
  return {
    kind: "security",
    // Telling of the change and asking nothing: a real holder refuses a pretext by the stop alone.
    subjectLine: "Deine E-Mail-Adresse soll sich ändern",
    origin: site,
    vorname: vorname ?? "",
    paragraphs: [
      [
        "Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen, weil diese Adresse nicht mehr erreichbar sein soll.",
        `Bestätigt die neue Adresse ihren Link, gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} danach.`,
      ],
      ["Hast Du das nicht veranlasst? Dann stoppe die Änderung über diesen Link.", "Er gilt, bis die Änderung wirksam wird."],
      [["Fragen jederzeit an ", { address: KONTAKT_EMAIL }, "."]],
    ],
    // The stop: no link approves anything.
    button: { label: ADRESSWECHSEL_STOPPEN, href: adresswechselLink(site, stoppToken) },
  };
}

/**
 * The completion notice: no control and no new address. The way to repudiate the change (NIST SP 800-63B-4,
 * read 2026-10-20: "clear instructions, including contact information") is the security kind's own last line.
 */
export function buildAdresswechselWirksamEmail({ vorname, instant: zeitpunkt }: FLAddressChangeEffectiveData, { origin }: MailOrigin): Mail {
  return {
    kind: "security",
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
export function buildAdresswechselNichtWirksamEmail(_daten: FLAddressChangeDiscardedData, { origin }: MailOrigin): Mail {
  return {
    kind: "security",
    subjectLine: "Deine E-Mail-Adresse wurde nicht geändert",
    origin: mailOrigin(origin),
    vorname: "",
    paragraphs: [
      ["Die Änderung Deiner E-Mail-Adresse ist nicht wirksam geworden.", ["Wir helfen Dir gern weiter: ", { address: KONTAKT_EMAIL }]],
    ],
  };
}
