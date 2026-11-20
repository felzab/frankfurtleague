import { FLSaisonPhase } from "@/core/generated/client/types";

import type { FLSaisonIdLength } from "@/core/generated/client/types";

/** The phases in the competition's own playing order: the backend declares `FLSaisonPhase` in that order. */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = Object.values(FLSaisonPhase);

/**
 * The width of a season's id, which the backend publishes. `saisons._id` is the string every `saison_id` references, so
 * a width only one tier moved breaks every row pointing at it.
 */
export const SAISON_ID_LENGTH = 4 satisfies FLSaisonIdLength;
