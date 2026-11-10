import "server-only";

import { BRAND_NAME, mailOrigin } from "./emailShell";
import { ROUTES } from "./routes";

import type { Mail } from "./emailShell";
import type { FLRegistrierungAbsageData, FLRegistrierungConfirmationDeadlineDays, FLRegistrierungLinkData } from "./generated/client/types";
import type { MailLink, MailOrigin } from "./mailKinds";

/**
 * The window the mail states, checked against `fl_backend/app/shared/schemas/bounds.py ::
 * REGISTRIERUNG_CONFIRMATION_DEADLINE_DAYS`: the backend moving it fails the type check here. Its own copy beside the
 * slice's, since `core` may not import a feature.
 */
const DEADLINE_DAYS = 14 satisfies FLRegistrierungConfirmationDeadlineDays;

// Beside the builders that spend it rather than in the slice: `core` may not import a feature.

/**
 * The one place a pupil's confirmation link is spelled.
 *
 * `token` is the parameter name because `nginx/shared/http.conf :: $credential_free_uri` matches that name;
 * a second spelling reaches the access line and the referer unredacted.
 */
function spielerBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${ROUTES.registrierungConfirmation.path()}?token=${encodeURIComponent(token)}`;
}

/**
 * The link a submission mints, named for the deadline the sweep deletes on. It names no pupil: this address has proved
 * nothing, and after a typo its stranger is owed no pupil's name.
 *
 * **The number is the backend's published bound, never a word here**: the mail and the page would otherwise state
 * two deadlines, and one would not move.
 */
export function buildRegistrierungBestaetigungEmail(
  { team: teamName, saison_id: saisonId }: FLRegistrierungLinkData,
  { origin, token }: MailLink,
): Mail {
  // Through `mailOrigin` once, and the link minted on what it answered: a raw `AUTH_URL` with a
  // trailing slash would otherwise put `//confirm/spieler` in every registering pupil's mail,
  // which the edge's noindex prefix does not match.
  const site = mailOrigin(origin);

  return {
    kind: "firstContact",
    // The team is in the subject because a pupil registering for two of them gets two of these, and
    // the season alone does not tell one from the other in an inbox.
    subjectLine: `Registrierung für ${teamName} bestätigen`,
    origin: site,
    paragraphs: [
      [["Du hast Dich für ", { strong: teamName }, ` in der Saison ${saisonId} der ${BRAND_NAME} registriert.`]],
      [
        "Über den Button unten bestätigst Du die Registrierung, trägst Dein Geburtsdatum ein und entscheidest, was mit Deinen Angaben passieren darf.",
        "Erst danach kann Dein Team Dich in den Kader aufnehmen.",
      ],
      [
        `Bestätigst Du nicht innerhalb von ${String(DEADLINE_DAYS)} Tagen, löschen wir die Registrierung mit allen Angaben.`,
        "Du kannst Dich dann über den Link Deines Teams neu registrieren.",
      ],
    ],
    button: { label: "Registrierung bestätigen", href: spielerBestaetigungsLink(site, token) },
  };
}

/**
 * The pupil's next step after a decline, by its reason: a team saying the address is somebody else's
 * refused the address rather than the pupil, so that note sends them back with one of their own.
 */
const ABSAGE_WEITER: Readonly<Record<NonNullable<FLRegistrierungAbsageData["reason"]> | "none", readonly [string, ...string[]]>> = {
  other_person: [
    "Unter dieser E-Mail-Adresse ist schon eine andere Person eingetragen.",
    "Registriere Dich bitte erneut über den Link Deines Teams, mit Deiner eigenen E-Mail-Adresse.",
  ],
  none: ["Hast Du Fragen zu dieser Entscheidung, sprich bitte mit Deinem Team."],
};

/**
 * The one note after a team declines a registration. It carries no confirmation link, only the league's landing: the
 * decision is the team's and stands.
 *
 * **It names no other person**: the reason it states is the stored choice, so whoever holds the
 * mailbox learns that an address is taken and never by whom.
 */
export function buildRegistrierungAbsageEmail(
  { team: teamName, saison_id: saisonId, reason }: FLRegistrierungAbsageData,
  { origin }: MailOrigin,
): Mail {
  const site = mailOrigin(origin);

  return {
    kind: "notice",
    subjectLine: `Deine Registrierung für ${teamName}`,
    origin: site,
    paragraphs: [
      [[{ strong: teamName }, ` hat Deine Registrierung für die Saison ${saisonId} der ${BRAND_NAME} abgelehnt.`]],
      ABSAGE_WEITER[reason ?? "none"],
      ["Deine Angaben aus der Registrierung löschen wir einen Monat nach dieser Entscheidung."],
    ],
    // The league's landing: no record is left to press on.
    button: { label: `Zur ${BRAND_NAME}`, href: site },
  };
}
