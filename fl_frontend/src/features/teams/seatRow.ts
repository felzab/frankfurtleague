import { COPY } from "@/core/copy/shared";

import type { Copy } from "@/core/copy";
import type { FLKontaktpersonAdmin, FLKontaktSeat } from "@/core/generated/client/types";
import type { SeatRow } from "@/kit/SeatRows";

/**
 * A seat row's words, on a club's season and on an application alike: the person's name, or the empty seat's muted
 * word, and the line naming the seats held, the address and the day the seat's state dates from.
 */
export function seatRow(
  seats: readonly FLKontaktSeat[],
  person: Pick<FLKontaktpersonAdmin, "first_name" | "last_name" | "email"> | null,
  day: Copy | null,
): Pick<SeatRow, "name" | "muted" | "line"> {
  return {
    name: person === null ? COPY.team.seatEmpty : { record: `${person.first_name} ${person.last_name}` },
    muted: person === null,
    line: COPY.team.seatLine(seats, person?.email ?? null, day),
  };
}
