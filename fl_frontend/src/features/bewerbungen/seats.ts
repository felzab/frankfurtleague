import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";
import { KONTAKT_ROLLEN, seatBesideTrainer } from "@/features/teams/constants";

import { deliveryChip } from "./zustellLage";

import type { Copy } from "@/core/copy";
import type { FLBewerbung, FLKontaktperson, FLKontaktRolle } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** Where a seat's answer stands. An application decided since leaves an unanswered seat `expired`: its link opens nothing. */
type SeatState = "confirmed" | "open" | "expired" | "objected" | "erased";

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
  open: { tone: "warn", label: COPY.template.open },
  expired: { tone: "neutral", label: COPY.admin.expired },
  objected: { tone: "danger", label: SERVER_COPY.entryConfirmation.objected },
  erased: { tone: "neutral", label: COPY.admin.erased },
};

/** One seat's state and its day. A Widerspruch and an erasure leave the same empty slot, parted by the day the first keeps. */
function standOf({ status, kontakte, confirmations }: FLBewerbung, seat: FLKontaktRolle): { state: SeatState; day: Copy | null } {
  const person = kontakte[seat];
  const entry = confirmations[seat];
  const confirmedAt = person?.einwilligung.confirmed_at ?? null;
  if (confirmedAt !== null) return { state: "confirmed", day: WORDS.confirmedOn(dayOf(confirmedAt)) };
  if (entry?.declined_at != null) return { state: "objected", day: WORDS.objectedOn(dayOf(entry.declined_at)) };
  if (person === null || entry === null) return { state: "erased", day: null };
  if (status !== "submitted") return { state: "expired", day: null };
  return entry.expired
    ? { state: "expired", day: WORDS.expiredOn(dayOf(entry.deadline)) }
    : { state: "open", day: WORDS.openUntil(dayOf(entry.deadline)) };
}

/**
 * The application's people, the Trainer first. One person holding two seats (`trainer_is_also`) stands once, on the
 * Trainer's row, as a club's seats do: the seat write and the re-send reach both from either, and one answer covers both.
 */
export function seatsOf(bewerbung: FLBewerbung): SeatView[] {
  const { kontakte, confirmations } = bewerbung;
  const also = seatBesideTrainer(kontakte);
  return KONTAKT_ROLLEN.filter(({ value }) => value !== also).map(({ value: seat }) => {
    const { state, day } = standOf(bewerbung, seat);
    const delivery = deliveryChip(confirmations[seat]?.delivery ?? null);
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
