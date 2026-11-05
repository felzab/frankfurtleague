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
  | { state: "valid"; gueltigBis: string; way: FLAddressChangeWay }
  | { state: "confirmed"; wirksamAb: string | null; genehmigungOffen: boolean; way: FLAddressChangeWay }
  | { state: OldViewPreviousState; gueltigBis: string | null; wirksamAb: string | null; way: FLAddressChangeWay }
  | { state: DeclineOnly; way: FLAddressChangeWay }
  // Pressed, so the backend refuses the decline too: told apart from `abgelaufen`, whose link was never pressed.
  | { state: "approval_expired"; way: FLAddressChangeWay }
  | { state: "ended"; side: FLAddressChangeViewEndedSide; art: FLAddressChangeEndArt }
  | { state: Exclude<AddressChangeLinkState, DeclineOnly> };

type WithoutPress = { state: "ended" | "confirmed" | "approval_expired" | "barred" | "invalid" };

/** What the page opens on. The token rides only with a link a press can still spend. */
export type AddressChangeStart =
  (Exclude<AddressChangeView, WithoutPress> & { token: string }) | Extract<AddressChangeView, WithoutPress> | { state: "unlesbar" };

/** The read's answer as the page holds it: the side is implied by the state. */
export function viewOf({ view: view }: Pick<FLAddressChangeViewResponse, "view">): AddressChangeView {
  if (view.state === "ended") return { state: "ended", side: view.side, art: view.art };
  if (view.side === "previous") {
    if (view.state === "release_open" || view.state === "release_expired") return { state: "invalid" };
    return { state: view.state, gueltigBis: view.valid_until, wirksamAb: view.effective_from, way: view.way };
  }

  switch (view.state) {
    // Null only on `confirmed`, by the read's contract; read as the dead link rather than a deadline of nothing.
    case "valid":
      return view.valid_until === null ? { state: "invalid" } : { state: "valid", gueltigBis: view.valid_until, way: view.way };
    case "confirmed":
      // Null only outside `confirmed`, by the read's contract.
      return { state: "confirmed", wirksamAb: view.effective_from, genehmigungOffen: view.approval_open === true, way: view.way };
    case "barred":
      return { state: "barred" };
    default:
      return { state: view.state, way: view.way };
  }
}

/** What the page opens on for what the read answered: every state a press can still spend keeps its token. */
export function startOf(read: AddressChangeView, token: string): AddressChangeStart {
  switch (read.state) {
    // A pressed link answers a second press with the change's end, so it holds no press either.
    case "ended":
    case "confirmed":
    case "approval_expired":
    case "barred":
    case "invalid":
      return read;
    default:
      return { ...read, token: token };
  }
}

/** A press that landed: the confirmation's outcome, `effective` where it took effect in this press. */
export type AddressChangePressed = {
  success: true;
  answer: "confirmed" | "declined" | "stopped";
  effective: boolean;
  effective_from: string | null;
  approval_open: boolean;
};
