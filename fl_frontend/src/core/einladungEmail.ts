import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";

import type { Mail } from "./emailShell";
import type { FLInvitationData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

/**
 * The one place a team's registration link is spelled, for the mail and for the panel the mint hands it to.
 * `token` is its parameter name for the reason `fl_frontend/src/core/kontaktLink.ts :: kontaktBestaetigungsLink` records.
 */
export function einladungsLink(origin: string, token: string): string {
  return `${origin}/registrierung?token=${encodeURIComponent(token)}`;
}

/**
 * What one confirmed contact seat is sent: the team's link, standing alone in the highlighted box, since it is to be
 * passed on rather than pressed, and so no button.
 */
export function buildEinladungEmail({ team: teamName, saison_id: saisonId }: FLInvitationData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  return {
    art: "mitteilung",
    subjectLine: `Registrierungslink für ${teamName}`,
    origin: site,
    vorname: "",
    paragraphs: [
      [
        [{ strong: teamName }, ` ist in die Saison ${saisonId} der ${BRAND_NAME} aufgenommen.`],
        "Über den Link unten registrieren sich die Spielerinnen und Spieler für diese Saison.",
        "Gib ihn an alle weiter, die für dieses Team spielen.",
      ],
      ["Diesen Link gibst Du weiter:"],
    ],
    block: { link: einladungsLink(site, token) },
    afterBlock: [
      ["Der Link gilt, solange die Registrierung für diese Saison geöffnet ist."],
      // The containment the link rests on: it authorises a PENDING registration and nothing else, so a
      // reader who forwards it widely is told what that costs before they do it rather than afterwards.
      [
        "Behandle den Link wie einen Schlüssel: Wer ihn hat, kann sich für dieses Team registrieren.",
        "Über jede Registrierung entscheidet Dein Team: Erst mit der Aufnahme in den Kader steht die Person darin.",
      ],
    ],
  };
}
