/**
 * SPIELTAGE · derivations
 *
 * Pure derivation over a season's playoff rounds — no I/O and no caching, which is why it stays out
 * of `queries.ts` rather than being folded in (ADR-0004).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • The bracket's edges live in `teamN_quelle` and nowhere else (ADR-0042). Position within a round
 *     is geometry, not topology: the 2026 draw feeds match 29 from 25 and 27, so any pairing derived
 *     from indices alone puts a match on the wrong branch.
 *   • Rounds arrive ordered by `order_val`, and the LAST round anchors the walk: each earlier round is
 *     ordered by the round after it, so the two feeders of one fixture sit adjacent and in the order
 *     that fixture's own sides name them.
 *   • A fixture nothing references keeps its arrival order, after the referenced ones. A `gruppe`
 *     reference and a `null` contribute no edge — the first knockout round is seeded from the group
 *     phase and has no earlier round to order (ADR-0043).
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — Quelle, for the two variants and what they reference
 */

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
