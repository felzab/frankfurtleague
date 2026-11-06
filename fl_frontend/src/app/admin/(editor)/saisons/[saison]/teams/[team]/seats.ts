import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";

import type { Copy } from "@/core/copy";
import type { FLKontaktperson, FLKontaktRolle, FLSaisonTeamConfirmationView, FLTeamMembership } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { SeatRow } from "@/kit/SeatRows";
import type { SeatTarget } from "./SeatActs";

const DAYS = COPY.admin.schiedsrichter;

/** The seats in the form's order, the Trainer's own row carrying the seat they also hold. */
const SEATS = ["trainer", "ansprechperson", "stellvertretung"] as const satisfies readonly FLKontaktRolle[];

/** Where a seat stands: its chip and the day under its name, `chip` none for a seat nobody ever held. */
function standingOf(
  person: FLKontaktperson | null,
  link: FLSaisonTeamConfirmationView | null,
  entered: boolean,
): { chip: ChipProps | null; day: Copy | null; asks: boolean } {
  if (person === null) {
    if (link?.declined_at != null) {
      return {
        chip: { tone: "danger", label: SERVER_COPY.entryConfirmation.objected },
        day: DAYS.objectedOn(dayOf(link.declined_at)),
        asks: false,
      };
    }
    // A row whose block stands holds an empty seat only by its person's erasure; a row with no block never held one.
    return { chip: entered ? { tone: "neutral", label: COPY.admin.erased } : null, day: null, asks: false };
  }
  const confirmed = person.einwilligung.confirmed_at;
  if (confirmed !== null)
    return { chip: { tone: "success", label: COPY.admin.confirmed }, day: DAYS.confirmedOn(dayOf(confirmed)), asks: false };
  if (link === null) return { chip: { tone: "warn", label: COPY.template.open }, day: null, asks: true };
  return link.expired
    ? { chip: { tone: "neutral", label: COPY.admin.expired }, day: DAYS.expiredOn(dayOf(link.deadline)), asks: true }
    : { chip: { tone: "warn", label: COPY.template.open }, day: DAYS.openUntil(dayOf(link.deadline)), asks: true };
}

/** One seat's row, and what its acts read: one row per person, the Trainer's carrying a second seat they hold. */
export function seatsOf({
  kontakte,
  confirmations,
}: Pick<FLTeamMembership, "kontakte" | "confirmations">): ReadonlyArray<Omit<SeatRow, "acts"> & { target: SeatTarget }> {
  const covered = kontakte?.trainer !== null ? (kontakte?.trainer_is_also ?? null) : null;
  return SEATS.filter((rolle) => rolle !== covered).map((rolle) => {
    const person = kontakte?.[rolle] ?? null;
    const link = confirmations?.[rolle] ?? null;
    const rollen = rolle === "trainer" && covered !== null ? [rolle, covered] : [rolle];
    const { chip, day, asks } = standingOf(person, link, kontakte != null);
    return {
      id: rolle,
      name: person === null ? COPY.admin.seatEmpty : { record: `${person.first_name} ${person.last_name}` },
      chips: chip === null ? [] : [chip],
      line: COPY.admin.seatLine(rollen, person?.email ?? null, day),
      muted: person === null,
      target: {
        rolle,
        asks,
        person:
          person === null ? null : { first_name: person.first_name, last_name: person.last_name, email: person.email, phone: person.phone },
        trainerAlso: rolle === "trainer" ? (kontakte?.trainer_is_also ?? null) : null,
      },
    };
  });
}
