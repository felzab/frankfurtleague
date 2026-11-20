import { COPY } from "@/core/copy/shared";

import type { Copy } from "@/core/copy";
import type { FLSaisonPhase, FLSpielJoined } from "@/core/generated/client/types";

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

/** A stored day or time before a later one, and a missing one after both: an ISO day or time sorts as its text. */
function earlierStored(one: string | null, other: string | null): number {
  if (one === other) return 0;
  if (one === null) return 1;
  if (other === null) return -1;
  return one < other ? -1 : 1;
}

/**
 * A matchday's matches as a visitor reads them, by when they kick off: by day, a match without a time after the timed
 * ones of its day, an undated one last, and the fixture number breaking a tie. The public pages alone sort so; the
 * administration keeps the fixture numbers' order the Spielplan's read serves.
 */
export function byKickOff(
  one: Pick<FLSpielJoined, "date" | "time" | "spiel_nr">,
  other: Pick<FLSpielJoined, "date" | "time" | "spiel_nr">,
): number {
  return earlierStored(one.date, other.date) || earlierStored(one.time, other.time) || one.spiel_nr - other.spiel_nr;
}
