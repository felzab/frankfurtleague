import "server-only";

import { ADDRESS_CHANGE_VALID_HOURS, ADDRESS_CHANGE_WAIT_SPAN } from "./adresswechsel";
import { ADRESSWECHSEL_STOPPEN } from "./adresswechselAntworten";
import { KONTAKT_EMAIL } from "./brand";
import { COPY } from "./copy";
import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatInstant } from "./format";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type {
  FLAddressChangeDiscardedData,
  FLAddressChangeEffectiveData,
  FLAddressChangeLinkData,
  FLAddressChangeNoticeData,
} from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

/**
 * The one spelling of the address page's link, the stop link's too, the page telling them apart by hash.
 * `token`, because `nginx/shared/http.conf :: $credential_free_uri` redacts that name alone.
 */
function addressChangeLink(origin: string, token: string): string {
  return `${origin}${ROUTES.addressChangeConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

const WORDS = SERVER_COPY.addressChange;

/** Both mails of the person's own change state the link's lifetime, which the backend refuses past. */
const LINK_VALID: Paragraph = [SERVER_COPY.mail.linkValidFor(ADDRESS_CHANGE_VALID_HOURS)];

/**
 * The link to the new address, asking only whether the mailbox is theirs. It greets nobody: behind a
 * mistyped address its reader is a stranger. It names no record, the change moving every one.
 */
export function buildAddressChangeEmail({ way, valid_until: validUntil }: FLAddressChangeLinkData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  // The person's own change, the address on file having confirmed it first: the page's question, its title the button.
  if (way === "account") {
    return {
      kind: "security",
      subjectLine: COPY.shared.withObject(WORDS.newAddress, "confirm"),
      origin: site,
      vorname: "",
      paragraphs: [[WORDS.new.question], LINK_VALID],
      button: { label: COPY.shared.withObject(COPY.signIn.address, "confirm"), href: addressChangeLink(site, token) },
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
        ["Bestätige sie bis ", { strong: formatInstant(validUntil) }, " über diesen Link."],
        "Er funktioniert nur einmal.",
        `Nach Deiner Bestätigung gilt sie ${ADDRESS_CHANGE_WAIT_SPAN} später.`,
      ],
    ],
    button: { label: "Adresse bestätigen", href: addressChangeLink(site, token) },
  };
}

/**
 * The mail to the address on file. It names no new address, which the page its link opens shows: the change may be
 * somebody else's mistake or a pretext, and a mail travels further than the page it links.
 */
export function buildAddressChangeNoticeEmail({ way, vorname }: FLAddressChangeNoticeData, { origin, token: stopToken }: MailLink): Mail {
  const site = mailOrigin(origin);

  // The person's own change asks the address on file first: its link confirms or declines the change.
  if (way === "account") {
    return {
      kind: "security",
      subjectLine: COPY.page.addressChangeConfirmation,
      origin: site,
      vorname: vorname ?? "",
      paragraphs: [[WORDS.previous.question, SERVER_COPY.mail.addressChange.previousEffect], LINK_VALID],
      button: { label: COPY.shared.withObject(WORDS.change, "confirm"), href: addressChangeLink(site, stopToken) },
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
        `Bestätigt die neue Adresse ihren Link, gilt sie ${ADDRESS_CHANGE_WAIT_SPAN} danach.`,
      ],
      ["Hast Du das nicht veranlasst? Dann stoppe die Änderung über diesen Link.", "Er gilt, bis die Änderung wirksam wird."],
      [["Fragen jederzeit an ", { address: KONTAKT_EMAIL }, "."]],
    ],
    // The stop: no link approves anything.
    button: { label: ADRESSWECHSEL_STOPPEN, href: addressChangeLink(site, stopToken) },
  };
}

/**
 * The completion notice: no control and no new address. The way to repudiate the change (NIST SP 800-63B-4,
 * read 2026-10-20: "clear instructions, including contact information") is the security kind's own last line.
 */
export function buildAddressChangeEffectiveEmail({ vorname, instant }: FLAddressChangeEffectiveData, { origin }: MailOrigin): Mail {
  return {
    kind: "security",
    subjectLine: "Deine E-Mail-Adresse wurde geändert",
    origin: mailOrigin(origin),
    vorname: vorname ?? "",
    paragraphs: [
      [
        ["Für Dein Konto bei der ", BRAND_NAME, " gilt seit ", { strong: formatInstant(instant) }, " eine neue E-Mail-Adresse."],
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
export function buildAddressChangeDiscardedEmail(_data: FLAddressChangeDiscardedData, { origin }: MailOrigin): Mail {
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
