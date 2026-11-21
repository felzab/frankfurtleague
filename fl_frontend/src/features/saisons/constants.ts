import { FLSaisonPhase } from "@/core/generated/client/types";

/** The phases in the competition's own playing order: the backend declares `FLSaisonPhase` in that order. */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = Object.values(FLSaisonPhase);
