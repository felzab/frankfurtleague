import type { FLPostausgangLage, FLPostausgangLageStand, FLPostausgangZustellungStand } from "@/core/generated/client/types";

/** The two grades a delivery is reported in: trouble that may clear, and trouble that will not. */
type Chip = { readonly label: string; readonly tone: "warning" | "danger" };

/**
 * What the provider reported about the last message, or `null` where it says nothing an administrator acts on: a
 * delivery is the ordinary course, and a chip for it would grade every row.
 */
const EREIGNIS_CHIP: Readonly<Record<FLPostausgangZustellungStand, Chip | null>> = {
  zugestellt: null,
  // What the administrator can act on is that the link has not arrived, not yet the address refusing for good.
  verzoegert: { label: "Noch nicht zugestellt", tone: "warning" },
  unzustellbar: { label: "Unzustellbar", tone: "danger" },
  // The message's fate, as its siblings say, and never the ban list's „gesperrt“: the list an administrator would
  // then search is the league's own, which never held this address.
  unterdrueckt: { label: "Zustellung blockiert", tone: "danger" },
  beschwerde: { label: "Als Spam gemeldet", tone: "danger" },
};

/**
 * What the outbox did with the last mail where the provider has said nothing about it. Owed and leaving, sent, and
 * dropped with a seat that moved since are the ordinary course and carry no chip.
 */
const STAND_CHIP: Readonly<Record<FLPostausgangLageStand, Chip | null>> = {
  offen: null,
  gesendet: null,
  entfallen: null,
  // The ban list kept it, the one case here the league's own list explains.
  gesperrt: { label: "Auf der Sperrliste", tone: "warning" },
  // A stack that mails nothing filed it: no address is at fault.
  zurueckgehalten: { label: "Nur abgelegt", tone: "warning" },
  // Every attempt failed until the deadline: the link never left.
  aufgegeben: { label: "Nicht gesendet", tone: "danger" },
};

/**
 * The one reading of a link's delivery for every editor showing one: the provider's event where it reported one, else
 * the outbox's own state, `null` where neither says anything to act on or no mail was ever owed.
 */
export function zustellungChip(lage: FLPostausgangLage | null): Chip | null {
  if (lage === null) return null;

  return lage.zustellung === null ? STAND_CHIP[lage.stand] : EREIGNIS_CHIP[lage.zustellung.stand];
}

/**
 * The states no further message to that address beats, as `fl_backend/app/api/postausgang/services.py :: unzustellbar`
 * reads them. **`beschwerde` is one of them**: a person who marked the league as spam is the strongest case for never
 * writing to them again.
 */
export function istUnzustellbar(lage: FLPostausgangLage | null): boolean {
  if (lage === null) return false;
  if (lage.stand === "aufgegeben") return true;

  const stand = lage.zustellung?.stand;
  return stand === "unzustellbar" || stand === "unterdrueckt" || stand === "beschwerde";
}
