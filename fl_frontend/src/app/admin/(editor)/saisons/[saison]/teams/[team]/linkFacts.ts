import { COPY } from "@/core/copy";
import { dayAfter, dayOf, formatDate } from "@/core/format";

import type { Copy } from "@/core/copy";
import type { FLTeamLinkState, FLTeamSaisonFacts } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

const WORDS = COPY.admin.team;
const LINK_WORDS = COPY.admin.saison;

/** Where the link stands, by the season's press and the live link: a club the press passes over, none yet, or its mail. */
function linkStateOf({ skipped, invitation, paused }: FLTeamLinkState): Copy {
  if (skipped === "no_kontakt_block" || skipped === "no_confirmed_kontaktperson") return LINK_WORDS.noConfirmedAddress;
  if (invitation === null) return LINK_WORDS.noLinkYet;
  if (paused) return LINK_WORDS.registrierungPaused;
  return invitation.sent_at === null ? LINK_WORDS.linkNotSent : LINK_WORDS.linkSentOn(dayOf(invitation.sent_at));
}

/**
 * The link box's facts: where the link stands, and the day from which an entry through it is a Nachnominierung. The
 * window's end closes no link: it opens on until the season ends, an entry made past that day standing outside the cap
 * (`fl_backend/app/api/saisons/services.py :: entry_is_a_nominee`, which counts a day past `end` and never `end` itself).
 */
export function linkFactsOf(link: FLTeamLinkState, { registrierung_end: end }: Pick<FLTeamSaisonFacts, "registrierung_end">): Fact[] {
  return [
    { label: COPY.admin.schiedsrichter.state, value: linkStateOf(link) },
    { label: WORDS.nomineeFrom, value: end === null ? COPY.shared.noValue : { record: formatDate(dayAfter(dayOf(end))) }, figures: true },
  ];
}
