import type { FLGruppenNames } from "@/core/generated/client/types";

/**
 * One group's fill state, from `buildGruppeOffer`. The pickers disable a full group; the junction
 * write's refusal (`entry_gruppe_full`) stays authoritative.
 */
export type GruppeOffer = {
  gruppe: FLGruppenNames;
  occupied: number;
  capacity: number;
};
