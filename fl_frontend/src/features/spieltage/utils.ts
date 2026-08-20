import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";

import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "./schemas";

/**
 * `PlayoffsView` draws its lines by index parity, true only if this has made it true — the Spiele
 * arrive sorted by `datum`, which says nothing about what feeds what. Walked last round first, so
 * each is ordered by the already-ordered round after it.
 */
export const orderRoundsByWiring = (rounds: readonly FLSpieltagWithSpiele[]): FLSpieltagWithSpiele[] => {
  const ordered: FLSpieltagWithSpiele[] = [];

  // Built back to front, so `ordered[0]` is the already-reordered round after the one in hand; the
  // last round anchors the walk unchanged.
  for (const round of [...rounds].reverse()) {
    const next = ordered[0];
    if (next === undefined) {
      ordered.unshift(round);
      continue;
    }

    const byNr = new Map(round.spiele.map((spiel) => [spiel.spiel_nr, spiel]));
    const fed: FLSpiel[] = [];
    const placed = new Set<number>();

    for (const spiel of next.spiele) {
      for (const quelle of [spiel.team1_quelle, spiel.team2_quelle]) {
        if (quelle?.type !== "spiel" || placed.has(quelle.spiel_nr)) continue;

        const source = byNr.get(quelle.spiel_nr);
        if (source === undefined) continue;

        placed.add(quelle.spiel_nr);
        fed.push(source);
      }
    }

    ordered.unshift(placed.size === 0 ? round : { ...round, spiele: [...fed, ...round.spiele.filter((spiel) => !placed.has(spiel.spiel_nr))] });
  }

  return ordered;
};

/**
 * What one matchday is called, from its phase and its place within it. `countInPhase` decides whether
 * a knockout round needs distinguishing: four quarter-finals over two dates are two matchdays a
 * reader has to tell apart.
 */
export function spieltagLabel({ phase, ordinal, countInPhase }: { phase: FLSaisonPhase; ordinal: number; countInPhase: number }): string {
  if (phase === "gruppenphase") return `${String(ordinal)}. Spieltag`;

  return countInPhase > 1 ? `${PHASE_LABELS[phase]} (${String(ordinal)})` : PHASE_LABELS[phase];
}

/**
 * Every matchday's label, keyed by id. **The ordinal is the served `position` and is never counted
 * from the arrival order**, so a filtered or reordered list labels each matchday the same way. Still
 * one pass, because `countInPhase` is only knowable once the whole phase has been seen.
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

/** One slot the matchday editor may offer, and whether another matchday of that phase already holds it. */
export type SpieltagPositionOffer = {
  position: number;
  isTaken: boolean;
};

/**
 * Positions 1..n+1 for `phase`, taken slots marked.
 *
 * **The append slot is always last and always free**, which is the one move a phase change needs; a
 * taken slot is offered and disabled rather than hidden, as the phase picker does.
 */
export function buildSpieltagPositionOffer(
  siblings: readonly { id: string; saison_phase: FLSaisonPhase; position: number }[],
  { phase, exceptId }: { phase: FLSaisonPhase | null; exceptId: string },
): readonly SpieltagPositionOffer[] {
  if (phase === null) return [];

  const inPhase = siblings.filter((sibling) => sibling.saison_phase === phase);
  const taken = new Set(inPhase.filter((sibling) => sibling.id !== exceptId).map((sibling) => sibling.position));
  // The highest slot ANYONE holds, this matchday included, so the append slot survives when it is
  // itself the last one — moving out to the end is how a slot lower down is freed for another.
  const highest = Math.max(0, ...inPhase.map((sibling) => sibling.position));

  return Array.from({ length: highest + 1 }, (_, index) => ({ position: index + 1, isTaken: taken.has(index + 1) }));
}

/**
 * The lowest slot the offer leaves free, which is what a matchday arriving in another phase takes.
 * Never `undefined` in practice — the offer's last entry is the append slot — and 1 for an empty phase.
 */
export function firstFreeSpieltagPosition(offer: readonly SpieltagPositionOffer[]): number {
  return offer.find((slot) => !slot.isTaken)?.position ?? 1;
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
 * narrowed rows would report a complete phase as short the moment somebody filtered. The count is
 * the served schedule — `buildSpieltagPhaseOffer` says why.
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
  const expectedByPhase = new Map(schedule.map((entry) => [entry.phase, entry.matchdays]));

  return SAISON_PHASE_OPTIONS.map((phase) => ({
    phase,
    angelegt: heldByPhase.get(phase) ?? 0,
    erwartet: expectedByPhase.get(phase) ?? 0,
  }));
}

/** One phase the matchday editor may offer, with the count that decides whether it may be picked. */
export type SpieltagPhaseOffer = {
  phase: FLSaisonPhase;
  /** How many matches one matchday of this phase holds in this season. Zero for a phase it does not play. */
  expected: number;
  /** Whether the fixtures already attached would still have somewhere to be played. */
  fits: boolean;
};

/**
 * **The counts are the SERVED schedule, never recomputed**: an odd group needs an extra round because
 * one team sits out, and a copy that undercounts disables a phase the endpoint accepts. **Only the
 * over-full direction is refused.**
 */
export function buildSpieltagPhaseOffer(schedule: readonly FLSaisonPhaseSchedule[], attachedCount: number): readonly SpieltagPhaseOffer[] {
  // No schedule means no season is selected, not a season that plays nothing: disabling a phase here
  // would refuse what the endpoint accepts.
  if (schedule.length === 0) return SAISON_PHASE_OPTIONS.map((phase) => ({ phase, expected: 0, fits: true }));

  const expectedByPhase = new Map(schedule.map((entry) => [entry.phase, entry.matches_per_matchday]));

  return SAISON_PHASE_OPTIONS.map((phase) => {
    const expected = expectedByPhase.get(phase) ?? 0;
    return { phase, expected, fits: attachedCount <= expected };
  });
}
