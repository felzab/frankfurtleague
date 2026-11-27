import "server-only";

import { COPY } from "./copy/shared";
import { dayOf, formatDateLong } from "./format";
import { mailedLinkTo, ROUTES } from "./routes";
import { SERVER_COPY } from "./serverCopy";

import type { Mail } from "./emailShell";
import type { FLKontaktLinkData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

const PAGE = SERVER_COPY.kontaktConfirmation;
const DEADLINE = SERVER_COPY.schiedsrichterConfirmation.deadline;

/**
 * What one person an administrator seated on a team's season row is asked, from the facts the Postausgang row holds and
 * the link its hand-out minted: on an open row to answer by the seat's own day, on a closed row, whose link takes the
 * Widerspruch alone, why and what an objection does. One person a mail: an address is one person, so `seats` are every
 * seat that one person holds. `token` is a bearer credential and is never taken apart here.
 */
export function buildKontaktConfirmationEmail(
  { seats, schule, saison_id: saison, deadline, row }: FLKontaktLinkData,
  { origin, token }: MailLink,
): Mail {
  const opening = PAGE.opening.seasonRow({ record: schule }, saison, COPY.team.seatsHeld(seats));
  const href = mailedLinkTo(origin, ROUTES.kontaktConfirmation, token);
  const shell = { audience: "firstContact", origin } as const;

  if (row === "open") {
    return {
      ...shell,
      subjectLine: SERVER_COPY.mail.kontakt.subject(schule),
      paragraphs: [[opening, SERVER_COPY.mail.bewerbung.confirmOrOppose], [DEADLINE(formatDateLong(dayOf(deadline)))]],
      button: { label: COPY.page.entryConfirmation, href },
    };
  }

  return {
    ...shell,
    subjectLine: SERVER_COPY.mail.kontakt.closedSubject(schule),
    paragraphs: [
      [opening, row === "exited" ? PAGE.teamDeparted({ record: schule }) : SERVER_COPY.refusalLine.saison_past, PAGE.objectionEffect.seasonRow],
    ],
    // Named for what the page offers: a closed row's page has nothing to confirm.
    button: { label: SERVER_COPY.mail.kontakt.toEntry, href },
  };
}
