import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { AddressChangeLinkState } from "./link";

/**
 * A refused link read as the panel it renders, or `null` where the read failed instead. Every state a live
 * or ended change can be in answers in a 200, so a refusal is a token nothing could place.
 */
export function mapAddressChangeViewRefusal(error: unknown): "invalid" | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void.
  if (error.serverErrorCode === "payload_refused") return "invalid";

  return isRuleRefusal(error) ? "invalid" : null;
}

/** What a refused press leaves the page showing: a panel, a re-read of the link, or the sentence of a drifted body. */
export type AddressChangePressRefusal = { state: AddressChangeLinkState } | { neuLesen: true } | ReturnType<typeof refusedPayloadAnswer>;

/** A refused answer or stop, or `null` where the code is none of these. */
export function mapAddressChangePressRefusal(error: unknown): AddressChangePressRefusal | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refused one is a drifted page, which the mail's link replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    case "link_invalid":
      return { state: "invalid" };
    // The change ended, or this link was answered, since the page opened: the link's own read says which,
    // so the page states how it ended rather than calling a live or a finished change void.
    case "address_change_ended":
      return { neuLesen: true };
    case "link_expired":
      return { state: "expired" };
    case "link_barred":
      return { state: "barred" };
    // The replaced address barred, the new one another pupil's, the administration's or holding entries of its own, or a
    // grant the approval does not cover: one panel, so the link's holder learns nothing about who holds an address.
    case "address_change_replaced_barred":
    case "address_change_taken":
    case "address_change_not_covered":
    case "address_change_new_granted":
    case "address_change_occupied":
    case "duplicate_key":
      return { state: "not_confirmable" };
    default:
      return null;
  }
}
