import { COPY } from "@/core/copy";
import { dayAfter } from "@/core/dayArithmetic";
import { dayOf, formatDate } from "@/core/format";

import type { Copy } from "@/core/copy";
import type { FLSaisonStatus, FLTeamLinkState, FLTeamSaisonFacts } from "@/core/generated/client/types";
import type { Fact } from "@/kit/Facts";

const WORDS = COPY.admin.team;
const LINK_WORDS = COPY.admin.saison;

/**
 * Where the link stands, by the season's press and the live link: a finished season, which shuts every link whatever
 * else stood, as the editor's „Abgeschlossen“ says; a club the press passes over, none yet, a link that opens nothing
 * for now, or its mail. A planned season's link opens nothing either until its activation, which is the state it is
 * minted and mailed in, so only a running season's shut link is said.
 */
function linkStateOf({ skipped, invitation, paused, running }: FLTeamLinkState, status: FLSaisonStatus): Copy {
  if (status === "past") return COPY.template.closed;
  if (skipped === "no_kontakt_block" || skipped === "no_confirmed_kontaktperson") return LINK_WORDS.noConfirmedAddress;
  if (invitation === null) return LINK_WORDS.noLinkYet;
  if (paused) return LINK_WORDS.registrierungPaused;
  // Not paused and not taking registrations while it runs: the season stores no window, so the link stays shut.
  if (!running && status === "active") return LINK_WORDS.noRegistrierungWindow;
  return invitation.sent_at === null ? LINK_WORDS.linkNotSent : LINK_WORDS.linkSentOn(dayOf(invitation.sent_at));
}

/**
 * The link box's facts: where the link stands, and the day from which an entry through it is a Nachnominierung. The
 * window's end closes no link: it opens on until the season ends, an entry made past that day standing outside the cap
 * (`fl_backend/app/api/saisons/services.py :: entry_is_a_nominee`, which counts a day past `end` and never `end` itself).
 */
export function linkFactsOf(
  link: FLTeamLinkState,
  { registrierung_end: end, status }: Pick<FLTeamSaisonFacts, "registrierung_end" | "status">,
): Fact[] {
  return [
    { label: COPY.admin.schiedsrichter.state, value: linkStateOf(link, status) },
    { label: WORDS.nomineeFrom, value: end === null ? COPY.shared.noValue : { record: formatDate(dayAfter(dayOf(end))) }, figures: true },
  ];
}
