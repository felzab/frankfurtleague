import { COPY } from "@/core/copy/shared";
import { dayOf } from "@/core/format";
import { KONTAKT_SEATS, seatBesideTrainer } from "@/features/teams/constants";
import { CONFIRMED_CHIP, ERASED_CHIP, EXPIRED_CHIP, NOT_SENT_CHIP, OBJECTED_CHIP, outOfPlayChip, UNCONFIRMED_CHIP } from "@/kit/stateChips";

import { deliveryChip } from "./deliveryState";

import type { Copy } from "@/core/copy";
import type { FLBewerbung, FLBewerbungConfirmation, FLKontaktpersonAdmin, FLKontaktSeat } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** Where a seat's answer stands, as the link's own page says it, and an erasure's entry, which the read serves as none. */
type SeatState = FLBewerbungConfirmation["state"] | "erased";

/** `seat` is the one its writes name, `seats` every seat the person holds. */
export type SeatView = {
  seat: FLKontaktSeat;
  seats: readonly FLKontaktSeat[];
  /** Null on a seat a Widerspruch or an erasure emptied. */
  person: FLKontaktpersonAdmin | null;
  state: SeatState;
  /** The chips after the name: the state, and the last mail's trouble where it met some. */
  chips: readonly [ChipProps, ...ChipProps[]];
  /** The day the state dates from, as the row's line says it; an erased seat keeps none. */
  day: Copy | null;
};

const STATE_CHIP: Readonly<Record<SeatState, ChipProps>> = {
  confirmed: CONFIRMED_CHIP,
  valid: UNCONFIRMED_CHIP,
  expired: EXPIRED_CHIP,
  declined: OBJECTED_CHIP,
  erased: ERASED_CHIP,
};

/** The day the seat's state dates from, a decided application's spent link naming none: its deadline is not why it ended. */
function dayOfState({ status, kontakte }: FLBewerbung, seat: FLKontaktSeat, entry: FLBewerbungConfirmation): Copy | null {
  const confirmedAt = kontakte[seat]?.einwilligung.confirmed_at ?? null;
  switch (entry.state) {
    case "confirmed":
      return confirmedAt === null ? null : COPY.shared.onDay(dayOf(confirmedAt));
    case "declined":
      return entry.declined_at === null ? null : COPY.shared.onDay(dayOf(entry.declined_at));
    case "expired":
      return status === "submitted" ? COPY.shared.onDay(dayOf(entry.deadline)) : null;
    case "valid":
      return COPY.shared.answerBy(dayOf(entry.deadline));
  }
}

/**
 * The application's people, the Trainer first. One person holding two seats (`trainer_is_also`) stands once, on the
 * Trainer's row, as a club's seats do: the seat write and the re-send reach both from either, and one answer covers both.
 * A link never sent is out of play once the season is `past`, as the applications list draws it: nobody can send it.
 */
export function seatsOf(bewerbung: FLBewerbung, past: boolean): SeatView[] {
  const { kontakte, confirmations } = bewerbung;
  const also = seatBesideTrainer(kontakte);
  return KONTAKT_SEATS.filter((seat) => seat !== also).map((seat) => {
    const entry = confirmations[seat];
    // An erasure clears the entry, which is all that parts it from the empty seat a Widerspruch leaves.
    const state = entry?.state ?? "erased";
    const day = entry === null ? null : dayOfState(bewerbung, seat, entry);
    const unsent = past ? outOfPlayChip(NOT_SENT_CHIP) : NOT_SENT_CHIP;
    const delivery = entry?.sent_at === null ? unsent : deliveryChip(entry?.delivery ?? null);
    return {
      seat,
      seats: seat === "trainer" && also !== null ? [seat, also] : [seat],
      person: kontakte[seat],
      state,
      chips: delivery === null ? [STATE_CHIP[state]] : [STATE_CHIP[state], delivery],
      day,
    };
  });
}
