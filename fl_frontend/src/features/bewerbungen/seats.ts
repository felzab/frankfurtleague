import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";
import { KONTAKT_ROLLEN, seatBesideTrainer } from "@/features/teams/constants";

import { deliveryChip } from "./deliveryState";

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

/** A seat the submission owed no mail, its mailbox holding too many unanswered links: „Link senden“ is what reaches it. */
const NOT_SENT: ChipProps = { tone: "warn", label: COPY.admin.saison.linkNotSent };

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
 * The application's people, the Trainer first. One person holding two seats (`trainer_is_also`) stands once, on the
 * Trainer's row, as a club's seats do: the seat write and the re-send reach both from either, and one answer covers both.
 */
export function seatsOf(bewerbung: FLBewerbung): SeatView[] {
  const { kontakte, confirmations } = bewerbung;
  const also = seatBesideTrainer(kontakte);
  return KONTAKT_ROLLEN.filter(({ value }) => value !== also).map(({ value: seat }) => {
    const entry = confirmations[seat];
    // An erasure clears the entry, which is all that parts it from the empty slot a Widerspruch leaves.
    const state = entry?.state ?? "erased";
    const day = entry === null ? null : dayOfState(bewerbung, seat, entry);
    const delivery = entry?.sent_at === null ? NOT_SENT : deliveryChip(entry?.delivery ?? null);
    return {
      seat,
      rollen: seat === "trainer" && also !== null ? [seat, also] : [seat],
      person: kontakte[seat],
      state,
      chips: delivery === null ? [STATE_CHIP[state]] : [STATE_CHIP[state], delivery],
      day,
    };
  });
}
