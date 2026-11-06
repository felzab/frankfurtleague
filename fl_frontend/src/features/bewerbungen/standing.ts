import { COPY } from "@/core/copy";
import { FLKontaktRolle } from "@/core/generated/client/types";

import type { FLBewerbungStatus } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** Every application holds these three seats, so „2 von 3“ counts against them. */
export const SEATS = Object.values(FLKontaktRolle).length;

/** Where an application stands: its decision, or while it has none whether every seat has confirmed. */
export type Standing = "incomplete" | "complete" | "accepted" | "declined";

const WORDS = COPY.admin.bewerbung;

export const STANDING_CHIP: Readonly<Record<Standing, ChipProps>> = {
  incomplete: { tone: "warn", label: WORDS.incomplete },
  complete: { tone: "info", label: WORDS.complete },
  accepted: { tone: "success", label: WORDS.accepted },
  declined: { tone: "danger", label: COPY.admin.spiel.declined },
};

/** An open `Dublette`: in the standing's place on a list's row, beside it on the review page. */
export const TEAM_DOUBLE: ChipProps = { tone: "warn", label: WORDS.teamDouble };

export function standingOf({ status, seats_confirmed: confirmed }: { status: FLBewerbungStatus; seats_confirmed: number }): Standing {
  if (status === "accepted" || status === "declined") return status;
  return confirmed === SEATS ? "complete" : "incomplete";
}
