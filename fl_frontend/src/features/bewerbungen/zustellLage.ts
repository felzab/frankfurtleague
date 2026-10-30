import type { FLBewerbung, FLOutboxDeliveryStand, FLOutboxState, FLOutboxStateStand } from "@/core/generated/client/types";

/** The two grades a delivery is reported in: trouble that may clear, and trouble that will not. */
type Chip = { readonly label: string; readonly tone: "warning" | "danger" };

/**
 * What the provider reported about the last message, or `null` where it says nothing an administrator acts on: a
 * delivery is the ordinary course, and a chip for it would grade every row.
 */
const EREIGNIS_CHIP: Readonly<Record<FLOutboxDeliveryStand, Chip | null>> = {
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
const STAND_CHIP: Readonly<Record<FLOutboxStateStand, Chip | null>> = {
  open: null,
  sent: null,
  dropped: null,
  // The ban list kept it, the one case here the league's own list explains.
  barred: { label: "Auf der Sperrliste", tone: "warning" },
  // A stack that mails nothing filed it: no address is at fault.
  withheld: { label: "Nur abgelegt", tone: "warning" },
  // Every attempt failed until the deadline: the link never left.
  abandoned: { label: "Nicht gesendet", tone: "danger" },
};

/**
 * The one reading of a link's delivery for every editor showing one: the provider's event where it reported one, else
 * the outbox's own state, `null` where neither says anything to act on or no mail was ever owed.
 */
export function zustellungChip(lage: FLOutboxState | null): Chip | null {
  if (lage === null) return null;

  return lage.delivery === null ? STAND_CHIP[lage.stand] : EREIGNIS_CHIP[lage.delivery.stand];
}

/** What the triage queue marks a row on. `danger` and never the duplicate mark's `warning`: this one cannot be waited out. */
export const ZUSTELLUNG_QUEUE_LABEL = "Kontakt unerreichbar";
export const ZUSTELLUNG_QUEUE_TINT = "danger";

/**
 * Whether any seat of this application holds an address no mail reaches. The queue reads it so an administrator meets
 * the fact where their eye already is, rather than on a page they never open.
 */
export function hatUnerreichbarenSitz({ confirmations: bestaetigungen }: Pick<FLBewerbung, "confirmations">): boolean {
  return Object.values(bestaetigungen).some((verlauf) => verlauf?.zustellung?.unzustellbar === true);
}
