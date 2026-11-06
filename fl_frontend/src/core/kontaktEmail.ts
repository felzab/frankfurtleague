import "server-only";

import { COPY } from "./copy";
import { mailOrigin } from "./emailShell";
import { dayOf, formatDateLong } from "./format";
import { kontaktBestaetigungsLink } from "./kontaktLink";
import { SERVER_COPY } from "./serverCopy";
import { rollenText } from "./teamVocabulary";

import type { Mail } from "./emailShell";
import type { FLKontaktLinkData } from "./generated/client/types";
import type { MailLink } from "./mailKinds";

const PAGE = SERVER_COPY.kontaktConfirmation;
const DEADLINE = SERVER_COPY.schiedsrichterConfirmation.deadline;

// No name: the administrator typed this address and nobody has confirmed it, so behind a typo its reader is a
// stranger, owed none. One person a mail: an address is one person, so `rollen` are the seats that one holds.
/**
 * What one person an administrator seated on a team's season row is asked, from the facts the Postausgang row holds and
 * the link its hand-out minted: on an open row to answer by the seat's own day, on a closed row, whose link takes the
 * Widerspruch alone, why and what an objection does. `token` is a bearer credential and is never taken apart here.
 */
export function buildKontaktBestaetigungEmail(
  { rollen, schule, saison_id: saison, deadline, row }: FLKontaktLinkData,
  { origin, token }: MailLink,
): Mail {
  const site = mailOrigin(origin);
  const opening = PAGE.opening.seasonRow({ record: schule }, saison, { record: rollenText(rollen) });
  const href = kontaktBestaetigungsLink(site, token);
  const shell = { kind: "firstContact", subjectLine: SERVER_COPY.mail.kontakt.subject(schule), origin: site, firstName: "" } as const;

  if (row === "open") {
    return {
      ...shell,
      paragraphs: [
        [opening, SERVER_COPY.mail.bewerbung.confirmOrOppose],
        [[`${DEADLINE.before} `, { strong: formatDateLong(dayOf(deadline)) }, DEADLINE.after]],
      ],
      button: { label: COPY.page.entryConfirmation, href },
    };
  }

  return {
    ...shell,
    paragraphs: [
      [opening, row === "exited" ? PAGE.teamDeparted({ record: schule }) : SERVER_COPY.refusalLine.saison_past, PAGE.objectionEffect.seasonRow],
    ],
    // Named for what the page offers: a closed row's page has nothing to confirm.
    button: { label: SERVER_COPY.mail.kontakt.toEntry, href },
  };
}
