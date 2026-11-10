import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail, Paragraph } from "./emailShell";
import type { FLRegistrierungAbsageData, FLRegistrierungConfirmationDeadlineDays, FLRegistrierungLinkData } from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

/**
 * The window the mail states, checked against `fl_backend/app/shared/schemas/bounds.py ::
 * REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS`: the backend moving it fails the type check here. Its own copy beside the
 * slice's, since `core` may not import a feature.
 */
const DEADLINE_DAYS = 14 satisfies FLRegistrierungConfirmationDeadlineDays;

const WORDS = SERVER_COPY.mail.registrierung;

/**
 * The one place a pupil's confirmation link is spelled, beside the builder that spends it rather than in the slice:
 * `core` may not import a feature.
 *
 * `token` is the parameter name because `nginx/shared/http.conf :: $credential_free_uri` matches that name;
 * a second spelling reaches the access line and the referer unredacted.
 */
function spielerBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${ROUTES.registrierungConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

/**
 * The link a submission mints, named for the deadline the sweep deletes on. It names no pupil: this address has proved
 * nothing, and after a typo its stranger is owed no pupil's name. Its lead is the confirmation page's own.
 *
 * **The number is the backend's published bound, never a word here**: the mail and the page would otherwise state
 * two deadlines, and one would not move.
 */
export function buildRegistrierungBestaetigungEmail({ team, saison_id: saisonId }: FLRegistrierungLinkData, { origin, token }: MailLink): Mail {
  // Through `mailOrigin` once, and the link minted on what it answered: a raw `AUTH_URL` with a
  // trailing slash would otherwise put `//confirm/spieler` in every registering pupil's mail,
  // which the edge's noindex prefix does not match.
  const site = mailOrigin(origin);

  return {
    kind: "firstContact",
    // The team is in the subject because a pupil registering for two of them gets two of these, and
    // the season alone does not tell one from the other in an inbox.
    subjectLine: WORDS.confirmation.subject(team),
    origin: site,
    paragraphs: [
      [SERVER_COPY.registrierungConfirmation.opening({ record: team }, saisonId)],
      [WORDS.confirmation.confirm, WORDS.confirmation.admission],
      [WORDS.confirmation.deadlineIn(DEADLINE_DAYS)],
    ],
    button: { label: COPY.page.registrierungConfirmation, href: spielerBestaetigungsLink(site, token) },
  };
}

/**
 * The pupil's next step after a decline, by its reason: a team saying the address is somebody else's
 * refused the address rather than the pupil, so that note sends them back with one of their own.
 */
const ABSAGE_WEITER: Readonly<Record<NonNullable<FLRegistrierungAbsageData["reason"]> | "none", Paragraph>> = {
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
      ABSAGE_WEITER[reason ?? "none"],
      ["Deine Angaben aus der Registrierung löschen wir einen Monat nach dieser Entscheidung."],
    ],
    // The league's landing: no record is left to press on.
    button: { label: COPY.shared.end.toHome, href: site },
  };
}
