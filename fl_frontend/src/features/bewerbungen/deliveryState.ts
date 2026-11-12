import { COPY } from "@/core/copy";

import type { FLOutboxDeliveryState, FLOutboxStatus, FLOutboxStatusState } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";

const DELIVERY = COPY.admin.delivery;

/** What the provider reported, as a seat's row says it; the ordinary course says nothing. */
const REPORTED: Readonly<Record<FLOutboxDeliveryState, ChipProps | null>> = {
  delivered: null,
  delayed: { tone: "warn", label: DELIVERY.delayed },
  undeliverable: { tone: "danger", label: DELIVERY.undeliverable },
  suppressed: { tone: "danger", label: DELIVERY.suppressed },
  complaint: { tone: "danger", label: DELIVERY.complaint },
};

/** What the outbox did with the mail where the provider said nothing. */
const OWED: Readonly<Record<FLOutboxStatusState, ChipProps | null>> = {
  open: null,
  sent: null,
  dropped: null,
  barred: { tone: "warn", label: COPY.admin.saison.addressBarred },
  // A stack that mails nothing filed it: no address is at fault, and nothing failed.
  held: { tone: "warn", label: DELIVERY.held },
  abandoned: { tone: "danger", label: COPY.admin.saison.linkNotSent },
};

export function deliveryChip(status: FLOutboxStatus | null): ChipProps | null {
  if (status === null) return null;
  return status.delivery === null ? OWED[status.state] : REPORTED[status.delivery.state];
}
