import type { FLErasedActorMarker } from "./generated/client/types";

/**
 * What the backend stores where an erased person was a record's actor. In `core`, so the log's rows and its filter
 * compare one spelling: another prints the marker as an address.
 */
export const ERASED_ACTOR_MARKER = "ERASED" satisfies FLErasedActorMarker;
