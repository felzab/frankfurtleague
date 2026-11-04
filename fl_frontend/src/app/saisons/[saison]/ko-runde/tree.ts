import "server-only";

import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { matchRowOf, whenOf } from "@/features/spiele/blocks";

import type { FLSpielJoined, FLSpielplanSpieltag, FLSpielQuelle } from "@/core/generated/client/types";
import type { BracketMatch, BracketRound } from "@/kit/BracketTree";

/** A match as its card in the tree: its date alone, the tree's own row naming the third place. */
function cardOf(spiel: FLSpielJoined): BracketMatch {
  const { id, href, team1, team2, result } = matchRowOf(spiel);
  return { id, href, when: whenOf(spiel), team1, team2, ...(result === undefined ? {} : { result }), anchor: spiel.id };
}

/** The match a side's winner comes from, by its number. */
const feederOf = (quelle: FLSpielQuelle | null): number | null =>
  quelle?.type === "spiel" && quelle.ausgang === "sieger" ? quelle.spiel_nr : null;

/**
 * The K.-o.-Baum from the knockout matchdays: one round per phase, the Finale last, each round in the bracket's
 * order, so a match stands under the two its sides' winners come from, read back from the Finale through each
 * side's source; a match no source names keeps its number's order after those that are placed. The third-place
 * match stands apart. `null` before the draw.
 */
export function treeOf(spieltage: readonly FLSpielplanSpieltag[]): { rounds: [BracketRound, ...BracketRound[]]; third?: BracketMatch } | null {
  const spiele = spieltage.flatMap((spieltag) => spieltag.spiele);
  const third = spiele.find((spiel) => spiel.for_third_place);
  const phases = SAISON_PHASE_OPTIONS.filter((phase) => phase !== "gruppenphase")
    .map((phase) => ({ phase, spiele: spiele.filter((spiel) => spiel.saison_phase === phase && spiel !== third) }))
    .filter((round) => round.spiele.length > 0);
  if (phases.length === 0) return null;

  // From the Finale up: each round ordered by the round after it, its matches' sources in their sides' order.
  const ordered: FLSpielJoined[][] = [];
  for (const [index, round] of [...phases].reverse().entries()) {
    const next = ordered[index - 1];
    const byNumber = [...round.spiele].sort((one, other) => one.spiel_nr - other.spiel_nr);
    if (next === undefined) {
      ordered.push(byNumber);
      continue;
    }
    const placed = next
      .flatMap((spiel) => [feederOf(spiel.team1_quelle), feederOf(spiel.team2_quelle)])
      .flatMap((nr) => byNumber.filter((spiel) => spiel.spiel_nr === nr));
    ordered.push([...placed, ...byNumber.filter((spiel) => !placed.includes(spiel))]);
  }

  // `ordered` holds the rounds from the Finale up, so reversed it lines up with `phases`, a round each.
  const rounds = ordered.reverse();
  const [first, ...rest] = phases.map(({ phase }, index) => ({
    id: phase,
    label: PHASE_LABELS[phase],
    matches: (rounds[index] ?? []).map(cardOf),
  }));
  if (first === undefined) return null;
  return { rounds: [first, ...rest], ...(third === undefined ? {} : { third: cardOf(third) }) };
}
