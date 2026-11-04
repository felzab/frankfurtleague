// Outside the view's "use client" module: the page reads the link on the server, where a client
// module's exports arrive only as references to render, and calling one throws.
import type {
  FLAddressChangeEndArt,
  FLAddressChangeViewEndedSide,
  FLAddressChangeViewPreviousState,
  FLAddressChangeViewResponse,
  FLAddressChangeWay,
} from "@/core/generated/client/types";

/** The new mailbox's states besides an open link, and a token the read matched to nothing. */
export type AddressChangeLinkState = "expired" | "invalid" | "barred" | "not_confirmable";

/**
 * The address on file's steps this view shows. The person's own change asks that address first, and the mailed page
 * answers that question and its lapse, so no such link reaches this view: `viewOf` reads one as the dead link.
 */
export type OldViewPreviousState = Exclude<FLAddressChangeViewPreviousState, "release_open" | "release_expired">;

/** The new mailbox's states the backend still takes the decline through, so the page keeps their token. */
type DeclineOnly = Extract<AddressChangeLinkState, "expired" | "not_confirmable">;

/**
 * What the link page is handed, never a name or an address: the page is open to whoever holds the link.
 * A pressed link and an ended change keep answering, so the page says how the change stands or ended.
 */
export type AddressChangeView =
  | { zustand: "valid"; gueltigBis: string; way: FLAddressChangeWay }
  | { zustand: "confirmed"; wirksamAb: string | null; genehmigungOffen: boolean; way: FLAddressChangeWay }
  | { zustand: OldViewPreviousState; gueltigBis: string | null; wirksamAb: string | null; way: FLAddressChangeWay }
  | { zustand: DeclineOnly; way: FLAddressChangeWay }
  // Pressed, so the backend refuses the decline too: told apart from `abgelaufen`, whose link was never pressed.
  | { zustand: "approval_expired"; way: FLAddressChangeWay }
  | { zustand: "ended"; side: FLAddressChangeViewEndedSide; art: FLAddressChangeEndArt }
  | { zustand: Exclude<AddressChangeLinkState, DeclineOnly> };

type WithoutPress = { zustand: "ended" | "confirmed" | "approval_expired" | "barred" | "invalid" };

/** What the page opens on. The token rides only with a link a press can still spend. */
export type AddressChangeStart =
  (Exclude<AddressChangeView, WithoutPress> & { token: string }) | Extract<AddressChangeView, WithoutPress> | { zustand: "unlesbar" };

/** The read's answer as the page holds it: the side is implied by the state. */
export function viewOf({ view: ansicht }: Pick<FLAddressChangeViewResponse, "view">): AddressChangeView {
  if (ansicht.state === "ended") return { zustand: "ended", side: ansicht.side, art: ansicht.art };
  if (ansicht.side === "previous") {
    if (ansicht.state === "release_open" || ansicht.state === "release_expired") return { zustand: "invalid" };
    return { zustand: ansicht.state, gueltigBis: ansicht.valid_until, wirksamAb: ansicht.effective_from, way: ansicht.way };
  }

  switch (ansicht.state) {
    // Null only on `bestaetigt`, by the read's contract; read as the dead link rather than a deadline of nothing.
    case "valid":
      return ansicht.valid_until === null ? { zustand: "invalid" } : { zustand: "valid", gueltigBis: ansicht.valid_until, way: ansicht.way };
    case "confirmed":
      // Null only outside `bestaetigt`, by the read's contract.
      return { zustand: "confirmed", wirksamAb: ansicht.effective_from, genehmigungOffen: ansicht.approval_open === true, way: ansicht.way };
    case "barred":
      return { zustand: "barred" };
    default:
      return { zustand: ansicht.state, way: ansicht.way };
  }
}

/** What the page opens on for what the read answered: every state a press can still spend keeps its token. */
export function startOf(gelesen: AddressChangeView, token: string): AddressChangeStart {
  switch (gelesen.zustand) {
    // A pressed link answers a second press with the change's end, so it holds no press either.
    case "ended":
    case "confirmed":
    case "approval_expired":
    case "barred":
    case "invalid":
      return gelesen;
    default:
      return { ...gelesen, token: token };
  }
}

/** A press that landed: the confirmation's outcome, `wirksam` where it took effect in this press. */
export type AddressChangePressed = {
  success: true;
  answer: "confirmed" | "declined" | "stopped";
  effective: boolean;
  effective_from: string | null;
  approval_open: boolean;
};
