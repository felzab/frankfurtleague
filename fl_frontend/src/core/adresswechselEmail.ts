import "server-only";

import { ADRESSWECHSEL_WARTEZEIT_DAUER } from "./adresswechsel";
import { ADRESSWECHSEL_STOPPEN } from "./adresswechselAntworten";
import { KONTAKT_EMAIL } from "./brand";
import { BRAND_NAME, mailOrigin } from "./emailShell";
import { formatZeitpunkt } from "./format";

import type { FLAdresswechselWeg } from "./generated/client/types";
import type { Absatz, Mail } from "./emailShell";

/** The one address page, both links' and every record's, under the segment `robots.ts` already turns crawlers back from. */
export const ADRESSWECHSEL_PFAD = "/bestaetigung/adresse";

/**
 * The one spelling of the address page's link, the stop link's too, the page telling them apart by hash.
 * `token`, because `nginx/shared/http.conf :: $credential_free_uri` redacts that name alone.
 */
function adresswechselLink(origin: string, token: string): string {
  return `${origin}${ADRESSWECHSEL_PFAD}?token=${encodeURIComponent(token)}`;
}

/** What the link to the new address is built from. */
export interface AdresswechselLinkData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  origin: string;
  /** The raw token. It is a bearer credential and is never taken apart here. */
  token: string;
  weg: FLAdresswechselWeg;
  /** The instant the link lapses, as the mint's own transaction set it. */
  gueltigBis: string;
}

/**
 * The link to the new address, asking only whether the mailbox is theirs. It greets nobody: behind a
 * mistyped address its reader is a stranger. It names no record, the change moving every one.
 */
export function buildAdresswechselEmail({ origin, token, weg, gueltigBis }: AdresswechselLinkData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "sicherheit",
    betreff: "Neue E-Mail-Adresse bestätigen",
    origin: site,
    vorname: "",
    absaetze: [
      [
        // The person typed it on the person's own start; the administration on either of its two.
        weg === "konto"
          ? `Für ein Konto bei der ${BRAND_NAME} wurde diese E-Mail-Adresse als neue angegeben.`
          : `Die Verwaltung der ${BRAND_NAME} hat diese E-Mail-Adresse für ein Konto eingetragen.`,
        [{ stark: "Sie gilt erst, wenn Du sie bestätigst. Bis dahin schreiben wir an die bisherige Adresse." }],
      ],
      [
        ["Bestätige sie bis ", { stark: formatZeitpunkt(gueltigBis) }, " über diesen Link."],
        "Er funktioniert nur einmal.",
        ...(weg === "wartezeit" ? [`Nach Deiner Bestätigung gilt sie ${ADRESSWECHSEL_WARTEZEIT_DAUER} später.`] : []),
      ],
    ],
    aktion: { label: "Adresse bestätigen", href: adresswechselLink(site, token) },
  };
}

/** What the notice to the address on file is built from. */
export interface AdresswechselHinweisData {
  /** The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`. */
  origin: string;
  /** The raw stop token, a bearer credential like the link's. */
  stoppToken: string;
  weg: FLAdresswechselWeg;
  /** The approval's deadline, which only `freigabe`'s notice states: the stop link outlives it. */
  gueltigBis: string;
  vorname: string;
}

/** Why the address on file is told, per way the change was started. */
function anlassAbsatz(weg: FLAdresswechselWeg, gueltigBis: string): Absatz {
  switch (weg) {
    case "konto":
      return [
        "In Deinem Konto wurde eine neue E-Mail-Adresse angegeben.",
        "Sie gilt erst, wenn sie über den Link bestätigt ist, den wir an sie geschickt haben.",
        "Bis dahin bleibt diese Adresse in Kraft.",
      ];
    case "freigabe":
      return [
        "Die Verwaltung hat eine neue E-Mail-Adresse für Dich eingetragen.",
        "Sie gilt nur, wenn Du sie in Deinem Konto freigibst.",
        "Gib sie nur frei, wenn Du das selbst bei uns angefragt hast.",
        // The approval is the account page's alone, so `freigabe` names the deadline that page keeps.
        ["Freigeben kannst Du sie bis ", { stark: formatZeitpunkt(gueltigBis) }, ", nachdem Du Dich mit dieser Adresse angemeldet hast."],
      ];
    case "wartezeit":
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
export function buildAdresswechselHinweisEmail({ origin, stoppToken, weg, gueltigBis, vorname }: AdresswechselHinweisData): Mail {
  const site = mailOrigin(origin);

  return {
    art: "sicherheit",
    // One subject for every way: the approval's request exists so a real holder can refuse a pretext, and a
    // subject telling them to approve would be its first instruction.
    betreff: "Deine E-Mail-Adresse soll sich ändern",
    origin: site,
    vorname: vorname,
    absaetze: [
      anlassAbsatz(weg, gueltigBis),
      ["Hast Du das nicht veranlasst? Dann stoppe die Änderung über diesen Link.", "Er gilt, bis die Änderung wirksam wird."],
      [["Fragen jederzeit an ", { adresse: KONTAKT_EMAIL }, "."]],
    ],
    // The stop on every way: no link approves anything, the account page asking a fresh sign-in first.
    aktion: { label: ADRESSWECHSEL_STOPPEN, href: adresswechselLink(site, stoppToken) },
  };
}

/**
 * The completion notice: no control and no new address. The way to repudiate the change (NIST SP 800-63B-4,
 * read 2026-10-20: "clear instructions, including contact information") is the security kind's own last line.
 */
export function buildAdresswechselWirksamEmail({ origin, vorname, zeitpunkt }: { origin: string; vorname: string; zeitpunkt: Date }): Mail {
  return {
    art: "sicherheit",
    betreff: "Deine E-Mail-Adresse wurde geändert",
    origin: mailOrigin(origin),
    vorname: vorname,
    absaetze: [
      [
        ["Für Dein Konto bei der ", BRAND_NAME, " gilt seit ", { stark: formatZeitpunkt(zeitpunkt) }, " eine neue E-Mail-Adresse."],
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
export function buildAdresswechselNichtWirksamEmail({ origin }: { origin: string }): Mail {
  return {
    art: "sicherheit",
    betreff: "Deine E-Mail-Adresse wurde nicht geändert",
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      ["Die Änderung Deiner E-Mail-Adresse ist nicht wirksam geworden.", ["Wir helfen Dir gern weiter: ", { adresse: KONTAKT_EMAIL }]],
    ],
  };
}
