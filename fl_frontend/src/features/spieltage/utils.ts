/**
 * SPIELTAGE · derivations
 *
 * Pure derivation over a season's matchdays — no I/O, no caching (ADR-0003). Two things live
 * here: the bracket's column order, and the NAME a matchday is shown under, which no document
 * stores (ADR-0051).
 *
 * Invariants:
 * - The bracket's edges are `teamN_quelle` only (ADR-0034) — position in a round is geometry,
 *   not topology.
 * - The LAST round anchors the walk, ordering each earlier one — which is why the backend's
 *   derived arrival order has to be right rather than plausible (ADR-0051).
 * - A fixture nothing references keeps its arrival order, after the referenced ones (ADR-0035).
 *
 * See:
 * - docs/glossary.md — Quelle, for the two variants and what they reference
 */

import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";

import type { FLSaisonPhase, FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLSpieltagWithSpiele } from "./schemas";

/**
 * The playoff rounds with each round's Spiele ordered by the bracket's wiring.
 *
 * `PlayoffsView` draws its connecting lines by index parity — the matches at indices 0 and 1 appear to
 * feed the first match of the next column. That is only true if this function has made it true: the
 * Spiele arrive sorted by `datum`, which says when a match is played and nothing about what it feeds.
 *
 * Walked from the last round backwards, so each round is ordered by the (already ordered) round after
 * it: for every fixture there, its `spiel`-variant sources are placed adjacent, `team1_quelle` first.
 * A match referenced twice is placed once, where it is first named — the resolution refuses the shape
 * that produces it, so this only decides how a hand-edited season renders. Matches nothing references
 * follow in arrival order, so a season with no wiring at all renders exactly as before.
 */
export const orderRoundsByWiring = (rounds: readonly FLSpieltagWithSpiele[]): FLSpieltagWithSpiele[] => {
  const ordered: FLSpieltagWithSpiele[] = [];

  // Built back to front, so `ordered[0]` is always the (already reordered) round after the one in
  // hand — the last round itself has nothing after it and anchors the walk unchanged.
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
 * What one matchday is called, from its phase and its place within that phase.
 *
 * **A matchday stores no name** (ADR-0051). One carries no information: a group-phase matchday is its
 * ordinal, a knockout matchday is its round. Both were already derivable — the ordinal from the order the
 * backend returns, the round from `PHASE_LABELS` — so a stored name was a second statement of the same
 * fact, and one nothing held consistent: two matchdays could share a name, and one called "Finale" could
 * sit in the `gruppenphase`.
 *
 * **It is composed here rather than served by the API**, because it is German display text. `quelle` set
 * that precedent: a reference carries no label, and what a reader sees is derived where it is shown
 * (ADR-0034). The backend has no German vocabulary for the phases and gains none for this.
 *
 * `ordinal` is 1-based and counted per phase over the arrival order. `countInPhase` decides whether a
 * knockout round needs distinguishing at all:
 *
 * - **Group phase** — always the ordinal. "1. Spieltag", "2. Spieltag".
 * - **A knockout round the season plays once** — the round alone. "Viertelfinale".
 * - **A round split across several matchdays** — the round plus its ordinal, because four quarter-finals
 *   over two dates are two matchdays and a reader has to be able to tell them apart. "Viertelfinale (1)".
 */
export function spieltagLabel({ phase, ordinal, countInPhase }: { phase: FLSaisonPhase; ordinal: number; countInPhase: number }): string {
  if (phase === "gruppenphase") return `${String(ordinal)}. Spieltag`;

  return countInPhase > 1 ? `${PHASE_LABELS[phase]} (${String(ordinal)})` : PHASE_LABELS[phase];
}

/**
 * Every matchday's label and per-phase ordinal, keyed by id, for a caller holding the whole season.
 *
 * Built in one pass rather than per row: the label needs `countInPhase`, which is only knowable once the
 * whole phase has been seen — so a component computing it per row would either be wrong on the first row
 * or re-scan the list for every one.
 *
 * The input must be in the API's order, and nothing here re-sorts it: the backend already answered that
 * question (ADR-0051).
 */
export function spieltagLabels(
  spieltage: readonly { id: string; saison_phase: FLSaisonPhase }[],
): Map<string, { label: string; ordinal: number }> {
  const countByPhase = new Map<FLSaisonPhase, number>();
  for (const spieltag of spieltage) {
    countByPhase.set(spieltag.saison_phase, (countByPhase.get(spieltag.saison_phase) ?? 0) + 1);
  }

  const seenInPhase = new Map<FLSaisonPhase, number>();
  const labels = new Map<string, { label: string; ordinal: number }>();
  for (const spieltag of spieltage) {
    const ordinal = (seenInPhase.get(spieltag.saison_phase) ?? 0) + 1;
    seenInPhase.set(spieltag.saison_phase, ordinal);
    labels.set(spieltag.id, {
      ordinal,
      label: spieltagLabel({ phase: spieltag.saison_phase, ordinal, countInPhase: countByPhase.get(spieltag.saison_phase) ?? 1 }),
    });
  }

  return labels;
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
 * Every phase, with this season's expected match count and whether a matchday holding `attachedCount`
 * fixtures may take it — the browser's half of `REQ-SPIELTAG-002`.
 *
 * **The counts are the SERVED schedule, never recomputed here** (ADR-0052). The arithmetic has a case a
 * hand-written copy gets wrong — an odd group needs an extra round, because one team sits out each round
 * — and a copy that undercounts disables a phase the endpoint would have accepted, which is worse than
 * not checking at all. `FLSaison.schedule` is that derivation on the wire.
 *
 * **Only the over-full direction is refused**, exactly as the endpoint does: a matchday still being
 * filled in holds fewer fixtures than its phase expects, and that is every season part-way through
 * setup. `attachedCount` of 0 therefore lets every phase through, which is what the create dialog needs
 * — a new matchday holds nothing, and a phase this season does not reach is a legal, if odd, choice the
 * endpoint accepts.
 *
 * A phase absent from the schedule expects 0, which is the same answer `expected_matches` gives.
 */
export function buildSpieltagPhaseOffer(schedule: readonly FLSaisonPhaseSchedule[], attachedCount: number): readonly SpieltagPhaseOffer[] {
  // No schedule means no season is selected, not a season that plays nothing: every real season's
  // schedule carries its group phase. Offering everything is the only safe answer, because disabling a
  // phase here would refuse what the endpoint accepts.
  if (schedule.length === 0) return SAISON_PHASE_OPTIONS.map((phase) => ({ phase, expected: 0, fits: true }));

  const expectedByPhase = new Map(schedule.map((entry) => [entry.phase, entry.matches_per_matchday]));

  return SAISON_PHASE_OPTIONS.map((phase) => {
    const expected = expectedByPhase.get(phase) ?? 0;
    return { phase, expected, fits: attachedCount <= expected };
  });
}
