import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";
import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";

import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "@/core/generated/client/types";

/**
 * What one matchday is called, from its phase and its place within it. `countInPhase` decides whether
 * a knockout round needs distinguishing: four quarter-finals over two dates are two matchdays a
 * reader has to tell apart.
 */
function spieltagLabel({ phase, ordinal, countInPhase }: { phase: FLSaisonPhase; ordinal: number; countInPhase: number }): string {
  if (phase === "gruppenphase") return COPY.shared.spieltag(ordinal);

  return countInPhase > 1 ? `${PHASE_LABELS[phase]} (${formatNumber(ordinal)})` : PHASE_LABELS[phase];
}

/**
 * Over the whole list, because `countInPhase` is knowable only once the phase has been seen. The
 * ordinal is the served `position`.
 */
export function spieltagLabels(
  spieltage: readonly { id: string; saison_phase: FLSaisonPhase; position: number }[],
): Map<string, { label: string; ordinal: number }> {
  const countByPhase = new Map<FLSaisonPhase, number>();
  for (const spieltag of spieltage) {
    countByPhase.set(spieltag.saison_phase, (countByPhase.get(spieltag.saison_phase) ?? 0) + 1);
  }

  const labels = new Map<string, { label: string; ordinal: number }>();
  for (const spieltag of spieltage) {
    labels.set(spieltag.id, {
      ordinal: spieltag.position,
      label: spieltagLabel({
        phase: spieltag.saison_phase,
        ordinal: spieltag.position,
        countInPhase: countByPhase.get(spieltag.saison_phase) ?? 1,
      }),
    });
  }

  return labels;
}

/** One phase of a season, with the matchdays it holds against the number its rules imply. */
export type SpieltagPhaseProgress = {
  phase: FLSaisonPhase;
  /** Matchdays the season holds in this phase. */
  angelegt: number;
  /** How many the season's rules imply. Zero for a phase this season's bracket does not reach. */
  erwartet: number;
};

/**
 * **Both numbers are facts about the SEASON, not about what is on screen**: a numerator from the
 * narrowed rows would report a complete phase as short. **The denominator is the SERVED schedule,
 * never recomputed**: an odd group needs an extra round.
 */
export function buildSpieltagPhaseProgress(
  schedule: readonly FLSaisonPhaseSchedule[],
  spieltage: readonly { saison_phase: FLSaisonPhase }[],
): readonly SpieltagPhaseProgress[] {
  if (schedule.length === 0) return [];

  const heldByPhase = new Map<FLSaisonPhase, number>();
  for (const spieltag of spieltage) {
    heldByPhase.set(spieltag.saison_phase, (heldByPhase.get(spieltag.saison_phase) ?? 0) + 1);
  }

  // A phase absent from the schedule expects 0, the same answer `expected_matches` gives: a matchday
  // may legally sit in a phase this season's bracket does not reach.
  const expectedByPhase = new Map(schedule.map((entry) => [entry.phase, entry.spieltage]));

  return SAISON_PHASE_OPTIONS.map((phase) => ({
    phase,
    angelegt: heldByPhase.get(phase) ?? 0,
    erwartet: expectedByPhase.get(phase) ?? 0,
  }));
}
