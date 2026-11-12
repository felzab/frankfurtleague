import "server-only";

import { DECLINED_RETENTION_DAYS, REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS } from "./bounds";
import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type { FLRegistrierungAbsageData, FLRegistrierungLinkData } from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.registrierung;

/**
 * The one place a pupil's confirmation link is spelled, beside the builder that spends it rather than in the slice:
 * `core` may not import a feature.
 *
 * `token` is the parameter name because the confirmation page reads that name alone.
 */
function spielerConfirmationLink(origin: string, token: string): string {
  return `${origin}${ROUTES.registrierungConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

/**
 * The link a submission mints, named for the deadline the sweep deletes on. It names no pupil: this address has proved
 * nothing, and after a typo its stranger is owed no pupil's name. Its lead is the confirmation page's own.
 *
 * **The number is the backend's published bound, never a word here**: the mail and the page would otherwise state
 * two deadlines, and one would not move.
 */
export function buildRegistrierungConfirmationEmail({ team, saison_id: saisonId }: FLRegistrierungLinkData, { origin, token }: MailLink): Mail {
  // Through `mailOrigin` once, and the link minted on what it answered: a raw `AUTH_URL` with a
  // trailing slash would otherwise put `//confirm/spieler` in every registering pupil's mail.
  const site = mailOrigin(origin);

  return {
    kind: "firstContact",
    // The team is in the subject because a pupil registering for two of them gets two of these, and
    // the season alone does not tell one from the other in an inbox.
    subjectLine: WORDS.confirmation.subject(team),
    origin: site,
    paragraphs: [
      [SERVER_COPY.registrierungConfirmation.opening({ record: team }, saisonId)],
      [WORDS.confirmation.admission],
      [WORDS.confirmation.deadlineIn(REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS)],
    ],
    button: { label: COPY.page.registrierungConfirmation, href: spielerConfirmationLink(site, token) },
  };
}

/**
 * The pupil's next step after a decline, by its reason: a team saying the address is somebody else's
 * refused the address rather than the pupil, so that note sends them back with one of their own.
 */
const DECLINE_NEXT_STEPS: Readonly<Record<NonNullable<FLRegistrierungAbsageData["reason"]> | "none", Paragraph>> = {
  other_person: [WORDS.absage.otherPerson, WORDS.absage.registerAgain],
  none: [WORDS.absage.askTeam],
};

/**
 * The one note after a team declines a registration. It carries no confirmation link, only the league's landing: the
 * decision is the team's and stands.
 *
 * **It names no other person**: the reason it states is the stored choice, so whoever holds the
 * mailbox learns that an address is taken and never by whom.
 */
export function buildRegistrierungAbsageEmail({ team, saison_id: saisonId, reason }: FLRegistrierungAbsageData, { origin }: MailOrigin): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "notice",
    subjectLine: WORDS.absage.subject(team),
    origin: site,
    paragraphs: [
      [[{ strong: team }, WORDS.absage.lead.after(saisonId)]],
      DECLINE_NEXT_STEPS[reason ?? "none"],
      [WORDS.absage.deletion(DECLINED_RETENTION_DAYS)],
    ],
    // The league's landing: no record is left to press on.
    button: { label: COPY.shared.end.toHome, href: site },
  };
}
