import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";

import { deliveryChip } from "./zustellLage";

import type { Copy } from "@/core/copy";
import type { FLBewerbung, FLBewerbungConfirmation, FLKontaktperson, FLKontaktRolle } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** Where a seat's answer stands, as the link's own page says it, and an erasure's entry, which the read serves as none. */
type SeatState = FLBewerbungConfirmation["state"] | "erased";

/** One person's row on an application: the seat its writes name, every seat they hold, and where those stand. */
export type SeatView = {
  seat: FLKontaktRolle;
  rollen: readonly FLKontaktRolle[];
  /** Null on a seat a Widerspruch or an erasure emptied. */
  person: FLKontaktperson | null;
  state: SeatState;
  /** The chips after the name: the state, and the last mail's trouble where it met some. */
  chips: readonly [ChipProps, ...ChipProps[]];
  /** The day the state dates from, as the row's line says it; an erased seat keeps none. */
  day: Copy | null;
};

const WORDS = COPY.admin.schiedsrichter;

const STATE_CHIP: Readonly<Record<SeatState, ChipProps>> = {
  confirmed: { tone: "success", label: COPY.admin.confirmed },
  valid: { tone: "warn", label: COPY.template.open },
  expired: { tone: "neutral", label: COPY.admin.expired },
  declined: { tone: "danger", label: SERVER_COPY.entryConfirmation.objected },
  erased: { tone: "neutral", label: COPY.admin.erased },
};

/** The day the seat's state dates from, a decided application's spent link naming none: its deadline is not why it ended. */
function dayOfState({ status, kontakte }: FLBewerbung, seat: FLKontaktRolle, entry: FLBewerbungConfirmation): Copy | null {
  const confirmedAt = kontakte[seat]?.einwilligung.confirmed_at ?? null;
  switch (entry.state) {
    case "confirmed":
      return confirmedAt === null ? null : WORDS.confirmedOn(dayOf(confirmedAt));
    case "declined":
      return entry.declined_at === null ? null : WORDS.objectedOn(dayOf(entry.declined_at));
    case "expired":
      return status === "submitted" ? WORDS.expiredOn(dayOf(entry.deadline)) : null;
    case "valid":
      return WORDS.openUntil(dayOf(entry.deadline));
  }
}

/**
 * The application's people in the label table's order. One person holding two seats (`trainer_is_also`) stands once, on
 * the seat they hold beside the Trainer's: the seat write and the re-send reach both from either, and one answer covers both.
 */
export function seatsOf(bewerbung: FLBewerbung): SeatView[] {
  const { kontakte, confirmations } = bewerbung;
  const also = kontakte.trainer_is_also;
  return KONTAKT_ROLLEN.filter(({ value }) => also === null || value !== "trainer").map(({ value: seat }) => {
    const entry = confirmations[seat];
    // An erasure clears the entry, which is all that parts it from the empty slot a Widerspruch leaves.
    const state = entry?.state ?? "erased";
    const day = entry === null ? null : dayOfState(bewerbung, seat, entry);
    const delivery = deliveryChip(entry?.delivery ?? null);
    return {
      seat,
      rollen: seat === also ? [seat, "trainer"] : [seat],
      person: kontakte[seat],
      state,
      chips: delivery === null ? [STATE_CHIP[state]] : [STATE_CHIP[state], delivery],
      day,
    };
  });
}
