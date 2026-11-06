import { COPY } from "@/core/copy";

import type { FLOutboxDeliveryState, FLOutboxStatus, FLOutboxStatusState } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

/** The two grades a delivery is reported in: trouble that may clear, and trouble that will not. */
type Chip = { readonly label: string; readonly tone: "warning" | "danger" };

/**
 * What the provider reported about the last message, or `null` where it says nothing an administrator acts on: a
 * delivery is the ordinary course, and a chip for it would grade every row.
 */
const EREIGNIS_CHIP: Readonly<Record<FLOutboxDeliveryState, Chip | null>> = {
  delivered: null,
  // What the administrator can act on is that the link has not arrived, not yet the address refusing for good.
  delayed: { label: "Noch nicht zugestellt", tone: "warning" },
  undeliverable: { label: "Unzustellbar", tone: "danger" },
  // The message's fate, as its siblings say, and never the ban list's „gesperrt“: the list an administrator would
  // then search is the league's own, which never held this address.
  suppressed: { label: "Zustellung blockiert", tone: "danger" },
  complaint: { label: "Als Spam gemeldet", tone: "danger" },
};

/**
 * What the outbox did with the last mail where the provider has said nothing about it. Owed and leaving, sent, and
 * dropped with a seat that moved since are the ordinary course and carry no chip.
 */
const STAND_CHIP: Readonly<Record<FLOutboxStatusState, Chip | null>> = {
  open: null,
  sent: null,
  dropped: null,
  // The ban list kept it, the one case here the league's own list explains.
  barred: { label: "Auf der Sperrliste", tone: "warning" },
  // A stack that mails nothing filed it: no address is at fault.
  held: { label: "Nur abgelegt", tone: "warning" },
  // Every attempt failed until the deadline: the link never left.
  abandoned: { label: "Nicht gesendet", tone: "danger" },
};

/**
 * The one reading of a link's delivery for every editor showing one: the provider's event where it reported one, else
 * the outbox's own state, `null` where neither says anything to act on or no mail was ever owed.
 */
export function zustellungChip(lage: FLOutboxStatus | null): Chip | null {
  if (lage === null) return null;

  return lage.delivery === null ? STAND_CHIP[lage.state] : EREIGNIS_CHIP[lage.delivery.state];
}

const DELIVERY = COPY.admin.delivery;

/** What the provider reported, as a seat's row says it; the ordinary course says nothing. */
const REPORTED: Readonly<Record<FLOutboxDeliveryState, ChipProps | null>> = {
  delivered: null,
  delayed: { tone: "warn", label: DELIVERY.delayed },
  undeliverable: { tone: "danger", label: DELIVERY.undeliverable },
  suppressed: { tone: "danger", label: DELIVERY.suppressed },
  complaint: { tone: "danger", label: DELIVERY.complaint },
};

/** What the outbox did with the mail where the provider said nothing. A stack that mails nothing has not sent it either. */
const OWED: Readonly<Record<FLOutboxStatusState, ChipProps | null>> = {
  open: null,
  sent: null,
  dropped: null,
  barred: { tone: "warn", label: COPY.admin.saison.addressBarred },
  held: { tone: "danger", label: COPY.admin.saison.linkNotSent },
  abandoned: { tone: "danger", label: COPY.admin.saison.linkNotSent },
};

/** A seat's second chip, where its last mail met trouble: the provider's event where it reported one, else the outbox's own state. */
export function deliveryChip(status: FLOutboxStatus | null): ChipProps | null {
  if (status === null) return null;
  return status.delivery === null ? OWED[status.state] : REPORTED[status.delivery.state];
}
