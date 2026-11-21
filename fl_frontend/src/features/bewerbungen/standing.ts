import { ADMIN_COPY } from "@/core/copy/admin";
import { KONTAKT_SEATS } from "@/features/teams/constants";
import { DECLINED_CHIP } from "@/kit/stateChips";

import type { FLBewerbungStatus } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** Where an application stands: its decision, or while it has none whether every seat has confirmed. */
export type Standing = "incomplete" | "complete" | "accepted" | "declined";

const WORDS = ADMIN_COPY.bewerbung;

export const STANDING_CHIP: Readonly<Record<Standing, ChipProps>> = {
  incomplete: { tone: "warn", label: WORDS.incomplete },
  complete: { tone: "info", label: WORDS.complete },
  accepted: { tone: "success", label: WORDS.accepted },
  declined: DECLINED_CHIP,
};

export const TEAM_DOUBLE: ChipProps = { tone: "warn", label: WORDS.teamDouble };

export function standingOf({ status, seats_confirmed: confirmed }: { status: FLBewerbungStatus; seats_confirmed: number }): Standing {
  if (status === "accepted" || status === "declined") return status;
  // Every application holds every seat, so it is complete once each has confirmed.
  return confirmed === KONTAKT_SEATS.length ? "complete" : "incomplete";
}
