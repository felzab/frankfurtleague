import type { FLPostSpielortPayload, FLSpielortPayloadDraft } from "./schemas";

/**
 * Derived from the payload schema the action validates, never restated, and widened at the rent for
 * `SchiedsrichterDraft`'s reason: an untouched or emptied box holds `null`, which the schema refuses by name.
 */
export type SpielortDraft = FLSpielortPayloadDraft<FLPostSpielortPayload>;
