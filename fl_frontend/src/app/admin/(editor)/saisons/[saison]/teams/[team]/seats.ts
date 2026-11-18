import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { deliveryChip } from "@/features/bewerbungen/deliveryState";
import { KONTAKT_SEATS, seatBesideTrainer } from "@/features/teams/constants";
import { CONFIRMED_CHIP, ERASED_CHIP, EXPIRED_CHIP, OBJECTED_CHIP, UNCONFIRMED_CHIP } from "@/kit/stateChips";

import type { Copy } from "@/core/copy";
import type {
  FLKontaktperson,
  FLKontaktSeat,
  FLSaisonTeamConfirmationView,
  FLTeamMembership,
  FLTrainerAlso,
} from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { SeatRow } from "@/kit/SeatRows";

const DAYS = COPY.admin.schiedsrichter;

/** What a seat's acts read: which seat, whether it waits on an answer, and the person the dialog starts from. */
export type SeatTarget = {
  seat: FLKontaktSeat;
  /** Every seat the row's person holds. */
  seats: readonly FLKontaktSeat[];
  /** A person waits on their answer, so a fresh link has someone to reach. */
  asks: boolean;
  person: { first_name: string; last_name: string; email: string; phone: string } | null;
  /** The other seat the Trainer holds, on the Trainer's row alone. */
  trainerAlso: FLTrainerAlso | null;
};

/** Where a seat stands: its chip and the day under its name, `chip` none for a seat nobody ever held. */
function standingOf(
  person: FLKontaktperson | null,
  link: FLSaisonTeamConfirmationView | null,
  entered: boolean,
): { chip: ChipProps | null; day: Copy | null; asks: boolean } {
  if (person === null) {
    if (link?.declined_at != null) {
      return { chip: OBJECTED_CHIP, day: DAYS.objectedOn(dayOf(link.declined_at)), asks: false };
    }
    // A row whose block stands holds an empty seat only by its person's erasure; a row with no block never held one.
    return { chip: entered ? ERASED_CHIP : null, day: null, asks: false };
  }
  const confirmed = person.einwilligung.confirmed_at;
  if (confirmed !== null) return { chip: CONFIRMED_CHIP, day: DAYS.confirmedOn(dayOf(confirmed)), asks: false };
  if (link === null) return { chip: UNCONFIRMED_CHIP, day: null, asks: true };
  return link.expired
    ? { chip: EXPIRED_CHIP, day: DAYS.expiredOn(dayOf(link.deadline)), asks: true }
    : { chip: UNCONFIRMED_CHIP, day: COPY.admin.spiel.answerBy(dayOf(link.deadline)), asks: true };
}

/** One seat's row, and what its acts read: one row per person, the Trainer's carrying a second seat they hold. */
export function seatsOf({
  kontakte,
  confirmations,
}: Pick<FLTeamMembership, "kontakte" | "confirmations">): ReadonlyArray<Omit<SeatRow, "acts"> & { target: SeatTarget }> {
  const covered = kontakte == null ? null : seatBesideTrainer(kontakte);
  return KONTAKT_SEATS.filter((seat) => seat !== covered).map((seat) => {
    const person = kontakte?.[seat] ?? null;
    const link = confirmations?.[seat] ?? null;
    const seats: FLKontaktSeat[] = seat === "trainer" && covered !== null ? [seat, covered] : [seat];
    const { chip, day, asks } = standingOf(person, link, kontakte != null);
    const delivery = deliveryChip(link?.delivery ?? null);
    return {
      id: seat,
      name: person === null ? COPY.admin.seatEmpty : { record: `${person.first_name} ${person.last_name}` },
      chips: [...(chip === null ? [] : [chip]), ...(delivery === null ? [] : [delivery])],
      line: COPY.admin.seatLine(seats, person?.email ?? null, day),
      muted: person === null,
      target: {
        seat,
        seats,
        asks,
        person:
          person === null ? null : { first_name: person.first_name, last_name: person.last_name, email: person.email, phone: person.phone },
        trainerAlso: seat === "trainer" ? (kontakte?.trainer_is_also ?? null) : null,
      },
    };
  });
}
