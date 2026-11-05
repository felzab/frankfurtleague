import { COPY } from "@/core/copy";
import { FLSaisonPhase } from "@/core/generated/client/types";

import type { Copy } from "@/core/copy";
import type { PillTone } from "@/shared/components/ui/badges";

/**
 * The phases in the competition's own playing order, which `PHASE_RANK` in
 * `fl_frontend/src/features/spiele/utils.ts` ranks against: the backend declares `FLSaisonPhase` in that order.
 */
export const SAISON_PHASE_OPTIONS: readonly FLSaisonPhase[] = Object.values(FLSaisonPhase);

/**
 * Each phase's German name, spelled once in the catalogue, for every surface. Not an export from
 * `fl_frontend/src/features/spiele/components/ui/SaisonPhaseChip.tsx`: the filter facets and a
 * Spieltag's composed name need the label and render nothing.
 */
export const PHASE_LABELS: Readonly<Record<FLSaisonPhase, Copy>> = COPY.shared.phase;

/**
 * A phase added to `FLSaisonPhase` with no member in
 * `fl_frontend/src/shared/components/ui/badges.ts :: PillTone` fails this annotation, which is what
 * pins the two sets together without `badges.ts` importing a feature.
 */
export const PHASE_TINTS: Record<FLSaisonPhase, PillTone> = {
  gruppenphase: "gruppenphase",
  achtelfinale: "achtelfinale",
  viertelfinale: "viertelfinale",
  halbfinale: "halbfinale",
  finale: "finale",
};

/**
 * Mirroring the backend's `SAISON_ID_LENGTH` (`fl_backend/app/shared/schemas/bounds.py`). `saisons._id` is the string
 * every `saison_id` references, so a width only one tier moved breaks every row pointing at it.
 */
export const SAISON_ID_LENGTH = 4;
