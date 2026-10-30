import type { FLPostausgangLage, FLPostausgangZustellungStand } from "@/core/generated/client/types";

/** The two grades a delivery is reported in: trouble that may clear, and trouble that will not. */
type Chip = { readonly label: string; readonly tone: "warning" | "danger" };

/**
 * What the provider reported about the last message, or `null` where it says nothing an administrator acts on: a
 * delivery is the ordinary course, and a chip for it would grade every row.
 */
const ZUSTELLUNG_CHIP: Readonly<Record<FLPostausgangZustellungStand, Chip | null>> = {
  zugestellt: null,
  // What the administrator can act on is that the link has not arrived, not yet the address refusing for good.
  verzoegert: { label: "Noch nicht zugestellt", tone: "warning" },
  unzustellbar: { label: "Unzustellbar", tone: "danger" },
  // The message's fate, as its siblings say, and never the ban list's „gesperrt“: the list an administrator would
  // then search is the league's own, which never held this address.
  unterdrueckt: { label: "Zustellung blockiert", tone: "danger" },
  beschwerde: { label: "Als Spam gemeldet", tone: "danger" },
};

/** A mail the outbox gave up on reached nobody, as an address that refused it did. */
const AUFGEGEBEN: Chip = { label: "Unzustellbar", tone: "danger" };

/**
 * The chip one link's delivery reads as, from the last mail owed about it, or `null` where there is nothing to report:
 * none owed, owed and leaving, sent, held back on a stack that mails nothing, or dropped with the seat that moved.
 */
export function lageChip(lage: FLPostausgangLage | null): Chip | null {
  if (lage === null) return null;
  if (lage.zustellung !== null) return ZUSTELLUNG_CHIP[lage.zustellung.stand];

  return lage.stand === "aufgegeben" ? AUFGEGEBEN : null;
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
