import "server-only";

import { CONFIRMATION_DEADLINE_DAYS } from "./bounds";
import { COPY } from "./copy/shared";
import { dayOf, formatDateLong } from "./format";
import { mailedLinkTo, ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type { FLRegistrierungAbsageData, FLRegistrierungLinkData } from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

const WORDS = SERVER_COPY.mail.registrierung;

/**
 * The link a submission mints, named for the deadline the sweep deletes on. It names no pupil: this address has proved
 * nothing, and after a typo its stranger is owed no pupil's name. Its lead and its deadline are the confirmation
 * page's own, the deadline the stored day the row carries, so the mail and the page name one day.
 */
export function buildRegistrierungConfirmationEmail(
  { team, saison_id: saisonId, deadline }: FLRegistrierungLinkData,
  { origin, token }: MailLink,
): Mail {
  return {
    audience: "firstContact",
    // The team is in the subject because a pupil registering for two of them gets two of these, and
    // the season alone does not tell one from the other in an inbox.
    subjectLine: WORDS.confirmation.subject(team),
    origin,
    paragraphs: [
      [SERVER_COPY.registrierungConfirmation.opening({ record: team }, saisonId)],
      [WORDS.confirmation.admission],
      [WORDS.confirmation.deadline(formatDateLong(dayOf(deadline)))],
    ],
    button: { label: COPY.page.registrierungConfirmation, href: mailedLinkTo(origin, ROUTES.registrierungConfirmation, token) },
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
  return {
    audience: "notice",
    subjectLine: WORDS.absage.subject(team),
    origin,
    paragraphs: [
      [WORDS.absage.lead(team, saisonId)],
      DECLINE_NEXT_STEPS[reason ?? "none"],
      [WORDS.absage.deletion(CONFIRMATION_DEADLINE_DAYS)],
    ],
    // The league's landing: no record is left to press on.
    button: { label: COPY.shared.end.toHome, href: origin },
  };
}
