import "server-only";

import {
  ANTWORT_SATZ_HTML,
  ANTWORT_SATZ_TEXT,
  ASIDE_TEXT,
  BRAND_NAME,
  brandPhrase,
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

const UEBERSCHRIFT = "Registrierungslink";

/**
 * The containment the link rests on (`docs/backend/spec.md :: I144`'s twin): it authorises a PENDING
 * registration and nothing else, so a reader who forwards it widely is told what that costs before
 * they do it rather than afterwards.
 */
const WEITERGABE_SATZ =
  "Behandle den Link wie einen Schlüssel: Wer ihn hat, kann sich für dieses Team registrieren. Über jede Registrierung entscheidet Dein Team: Erst mit der Aufnahme in den Kader steht die Person darin.";

const FALLBACK_SATZ = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";

/** What one contact seat is sent, one message per address the fan-out tried. */
export interface EinladungEmailData {
  /** The club as the season's junction row names it, so a seat holding two teams can tell them apart. */
  readonly teamName: string;
  readonly saisonId: string;
  /** The serving origin (`docs/frontend/spec.md :: I186`), which the shell's close is drawn on too. */
  readonly origin: string;
  /** The finished absolute URL. The token inside it is a bearer credential and is never taken apart here. */
  readonly link: string;
}

export type EinladungEmail = { subject: string; html: string; text: string };

/**
 * One control, as the sign-in message carries one (`fl_frontend/src/core/authEmail.ts :: aktionen`):
 * the message exists for this link alone, and a second destination competes with the one press a
 * reader came for.
 */
function aktionen(url: string): readonly Aktion[] {
  return [{ href: url, label: "Zur Registrierung", ton: "primary" }];
}

function renderHtml({ teamName, saisonId, link: url, origin }: EinladungEmailData): string {
  return renderKarte({
    titel: `${BRAND_NAME}: ${UEBERSCHRIFT} für ${teamName}`,
    ueberschrift: escapeHtml(UEBERSCHRIFT),
    bloecke: [
      paragraph(
        `${strong(escapeHtml(teamName))} ist in die ${brandPhrase(`Saison ${escapeHtml(saisonId)}`)} der ${BRAND_NAME} aufgenommen. Über den Link unten registrieren sich die Spielerinnen und Spieler für diese Saison. Gib ihn an alle weiter, die für dieses Team spielen.`,
      ),
      paragraph(`Der Link gilt, solange die Registrierung für diese Saison geöffnet ist.`),
      paragraph(FALLBACK_SATZ, "0 0 8px", ASIDE_TEXT),
      /* The link runs past the card's width, so this one paragraph breaks inside a word, as the
         sign-in message's does. Marked as a link as well: an address a reader has to select and
         paste is not a route. */
      paragraph(link(url, url), "0 0 16px", `${ASIDE_TEXT}word-break:break-all;`),
      paragraph(escapeHtml(WEITERGABE_SATZ), "0", ASIDE_TEXT),
    ],
    aktionen: aktionen(url),
    fuss: ANTWORT_SATZ_HTML,
    origin: origin,
  });
}

function renderText({ teamName, saisonId, link: url, origin }: EinladungEmailData): string {
  const oben = [
    `${BRAND_NAME}: ${UEBERSCHRIFT} für ${teamName}`,
    "",
    `${teamName} ist in die Saison ${saisonId} der ${BRAND_NAME} aufgenommen.`,
    "Über diesen Link registrieren sich die Spielerinnen und Spieler für diese Saison. Gib ihn an alle weiter, die für dieses Team spielen.",
    "",
    url,
    "",
    "Der Link gilt, solange die Registrierung für diese Saison geöffnet ist.",
    "",
    WEITERGABE_SATZ,
  ];

  return [stuffSignatureDelimiter(oben.join("\n")), ...textFooter(origin, [ANTWORT_SATZ_TEXT])].join("\n");
}

/**
 * **The two parts state the same facts**, as the application messages do
 * (`fl_frontend/src/core/bewerbungEmail.ts :: buildBewerbungZusageEmail`).
 */
export function buildEinladungEmail(data: EinladungEmailData): EinladungEmail {
  // Through `mailOrigin` once, for the close: the link itself is spelled by its own module and
  // arrives finished, so a second derivation here could send the two halves to different hosts.
  const site = mailOrigin(data.origin);

  return {
    subject: `${UEBERSCHRIFT} für ${data.teamName}: ${BRAND_NAME}, Saison ${data.saisonId}`,
    html: renderHtml({ ...data, origin: site }),
    text: renderText({ ...data, origin: site }),
  };
}
