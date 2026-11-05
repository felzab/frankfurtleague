import "server-only";

import { mailOrigin } from "./emailShell";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";
import type { FLInvitationData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

const WORDS = SERVER_COPY.mail.einladung;

/**
 * The one place a team's registration link is spelled, for the mail and for the panel the mint hands it to.
 * `token` is its parameter name for the reason `fl_frontend/src/core/kontaktLink.ts :: kontaktBestaetigungsLink` records.
 */
export function einladungsLink(origin: string, token: string): string {
  return `${origin}${ROUTES.registrierung.path()}?token=${encodeURIComponent(token)}`;
}

/**
 * What one confirmed contact seat is sent: the team's link, standing alone in the highlighted box, since it is to be
 * passed on rather than pressed, and so no button.
 */
export function buildEinladungEmail({ team, saison_id: saisonId }: FLInvitationData, { origin, token }: MailLink): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "notice",
    subjectLine: WORDS.subject(team),
    origin: site,
    vorname: "",
    paragraphs: [[WORDS.passOn(saisonId, team)]],
    block: { link: einladungsLink(site, token) },
    afterBlock: [
      // The containment the link rests on: it authorises a pending registration and nothing else, so a reader who
      // forwards it widely is told what that costs before they do it rather than afterwards.
      [WORDS.key, WORDS.admission],
      [WORDS.valid],
    ],
  };
}
