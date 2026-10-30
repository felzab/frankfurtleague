import type { FLSchiedsrichter, FLSchiedsrichterBestaetigungAnsichtResponse } from "@/core/generated/client/types";
import type { FLPostSchiedsrichterPayload, FLSchiedsrichterPayloadDraft } from "./schemas";

/** Every state the referee's link can be in but open. „ungueltig“ is this side's, for a token the read refused. */
export type SchiedsrichterLinkZustand = "bestaetigt" | "abgelaufen" | "ungueltig" | "gesperrt";

export type SchiedsrichterAnsicht =
  { zustand: "gueltig"; ansicht: FLSchiedsrichterBestaetigungAnsichtResponse } | { zustand: SchiedsrichterLinkZustand };

// The three admin-only blocks are out: a fixture's held referee and a just-created one are each
// composed at the call site, where a required block would be written as a null claiming the referee
// has no link.
/**
 * A referee whose `name` is the word on screen rather than the stored one, so a control that must
 * show something takes an erased referee without a null reaching it. Built through
 * `fl_frontend/src/features/schiedsrichter/constants.ts :: bookedSchiedsrichterName`.
 */
export type FLSchiedsrichterAngezeigt = Pick<FLSchiedsrichter, "id" | "schule" | "kontakt" | "default_payment" | "inactive_since"> & {
  name: string;
  /** Where `name` is a stand-in word rather than a stored name, which a control sets in the empty-value grade. */
  nameIstPlatzhalter?: boolean;
};

/**
 * Derived from the payload schema the action validates, never restated; the widening at the fee is
 * `fl_frontend/src/features/schiedsrichter/schemas.ts :: FLSchiedsrichterPayloadDraft`'s.
 */
export type SchiedsrichterDraft = FLSchiedsrichterPayloadDraft<FLPostSchiedsrichterPayload>;
