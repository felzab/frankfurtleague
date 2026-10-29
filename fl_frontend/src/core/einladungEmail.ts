import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";

import type { Mail } from "./emailShell";

/** What one contact seat is sent, one message per address the fan-out tried. */
export interface EinladungEmailData {
  /** The club as the season's junction row names it, so a seat holding two teams can tell them apart. */
  readonly teamName: string;
  readonly saisonId: string;
  /** The serving origin, which the shell's footer is drawn on too. */
  readonly origin: string;
  /** The finished absolute URL. The token inside it is a bearer credential and is never taken apart here. */
  readonly link: string;
}

export function buildEinladungEmail({ teamName, saisonId, origin, link }: EinladungEmailData): Mail {
  return {
    art: "mitteilung",
    betreff: `Registrierungslink für ${teamName}`,
    // Through `mailOrigin` once, for the footer: the link itself is spelled by its own module and
    // arrives finished, so a second derivation here could send the two versions to different hosts.
    origin: mailOrigin(origin),
    vorname: "",
    absaetze: [
      [
        [{ stark: teamName }, ` ist in die Saison ${saisonId} der ${BRAND_NAME} aufgenommen.`],
        "Über den Link unten registrieren sich die Spielerinnen und Spieler für diese Saison.",
        "Gib ihn an alle weiter, die für dieses Team spielen.",
      ],
      ["Der Link gilt, solange die Registrierung für diese Saison geöffnet ist."],
      // The containment the link rests on: it authorises a PENDING registration and nothing else, so a
      // reader who forwards it widely is told what that costs before they do it rather than afterwards.
      [
        "Behandle den Link wie einen Schlüssel: Wer ihn hat, kann sich für dieses Team registrieren.",
        "Über jede Registrierung entscheidet Dein Team: Erst mit der Aufnahme in den Kader steht die Person darin.",
      ],
    ],
    aktion: { label: "Zur Registrierung", href: link },
  };
}
