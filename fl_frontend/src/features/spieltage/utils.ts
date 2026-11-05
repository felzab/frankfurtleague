import { COPY } from "@/core/copy";

import type { Copy } from "@/core/copy";
import type { FLSaisonPhase } from "@/core/generated/client/types";

/**
 * What one matchday is called, from its phase and its place within it. `countInPhase` decides whether
 * a knockout round needs distinguishing: four quarter-finals over two dates are two matchdays a
 * reader has to tell apart.
 */
export function spieltagLabel({ phase, ordinal, countInPhase }: { phase: FLSaisonPhase; ordinal: number; countInPhase: number }): Copy {
  if (phase === "gruppenphase") return COPY.shared.spieltag(ordinal);

  return countInPhase > 1 ? COPY.shared.knockoutRound(COPY.shared.phase[phase], ordinal) : COPY.shared.phase[phase];
}

type Placed = { saison_phase: FLSaisonPhase; position: number };

/**
 * Each matchday's name, read over the whole list once, because `countInPhase` is knowable only once the phase has
 * been seen. The ordinal is the served `position`.
 */
export function spieltagNamer(spieltage: readonly Placed[]): (spieltag: Placed) => Copy {
  const countByPhase = new Map<FLSaisonPhase, number>();
  for (const spieltag of spieltage) {
    countByPhase.set(spieltag.saison_phase, (countByPhase.get(spieltag.saison_phase) ?? 0) + 1);
  }
  return (spieltag) =>
    spieltagLabel({ phase: spieltag.saison_phase, ordinal: spieltag.position, countInPhase: countByPhase.get(spieltag.saison_phase) ?? 1 });
}
